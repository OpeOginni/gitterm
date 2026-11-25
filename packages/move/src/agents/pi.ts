import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PI_EXTENSION, PI_EXTENSION_PATH, PI_TMUX_SESSION } from "@gitterm/schema/pi";
import { agentScript, scriptSession } from "../script.js";
import { runs, type AgentAdapter, type ExportedSession } from "./types.js";

/**
 * Pi sessions: one JSONL file each, under
 * `<agent dir>/sessions/--<cwd with / \ : as ->--/<timestamp>_<id>.jsonl`. The first line is
 * a header with the session's id and working directory; entries form a tree by `parentId`.
 * Pi reads a file only when it opens it, so a copy resumes as the same conversation.
 *
 * Pi has no server to start a turn in. A notice for the session goes to
 * `<agent dir>/gitterm/inbox/<id>.txt`, which GitTerm's Pi extension sends when the session
 * opens; in a workspace, `notify` also opens it in the tmux session the terminal attaches to.
 * While Pi works in a session, the extension keeps Pi's process id in
 * `<agent dir>/gitterm/busy/<id>`, which `status` reads.
 */
const PI_SCRIPT = agentScript(String.raw`
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
const sessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR || path.join(agentDir, "sessions");
// Workspaces install Pi in ~/.local/bin, which a command's PATH may lack.
const localPi = path.join(home, ".local", "bin", "pi");
const piBin = process.env.GITTERM_PI_BIN || (fs.existsSync(localPi) ? localPi : "pi");
const encode = (cwd) => "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";
const has = (command) => { try { cp.execFileSync("sh", ["-c", "command -v " + command], { stdio: "ignore" }); return true; } catch { return false; } };

function sessionFile(id) {
  for (const dir of fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []) {
    const folder = path.join(sessionsDir, dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    const name = fs.readdirSync(folder).find((file) => file.endsWith("_" + id + ".jsonl"));
    if (name) return path.join(folder, name);
  }
  fail("Pi's session " + id + " was not found under " + sessionsDir + ".");
}

function entries(text) {
  return text.split("\n").filter((line) => line.trim()).map((line) => { try { return JSON.parse(line); } catch { return null; } });
}

/** Whether a running Pi is working in the session, as GitTerm's Pi extension records it. */
function busy(id) {
  let pid;
  try { pid = Number(fs.readFileSync(path.join(agentDir, "gitterm", "busy", id), "utf8")); } catch { return false; }
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

const textOf = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((part) => part && part.type === "text").map((part) => part.text).join(" ") : "";

const ops = {
  async info() {
    let version = "unknown";
    try { version = cp.execFileSync(piBin, ["--version"], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
    return { version };
  },

  async export() {
    const file = sessionFile(input.ref);
    const text = fs.readFileSync(file, "utf8");
    const all = entries(text);
    const header = all[0];
    if (!header || header.type !== "session") fail(file + " is not a Pi session.");
    if (!input.allowBusy && busy(header.id)) fail("Pi is still working in this session. Let it finish or stop it, then try again.");
    let title = "";
    for (const entry of all) if (entry && entry.type === "session_info" && entry.name) title = entry.name;
    if (!title) {
      const first = all.find((entry) => entry && entry.type === "message" && entry.message && entry.message.role === "user");
      title = textOf(first && first.message.content).slice(0, 80);
    }
    return {
      ref: header.id,
      cwd: header.cwd,
      title,
      mark: Buffer.byteLength(text),
      payload: { session: zlib.gzipSync(text).toString("base64") },
    };
  },

  /** A new session for cwd, or with "ref" that session's contents replaced (a copy is kept). */
  async import() {
    const cwd = real(input.cwd);
    const lines = zlib.gunzipSync(Buffer.from(input.payload.session, "base64")).toString("utf8").split("\n");
    const header = JSON.parse(lines[0]);
    const id = input.ref || crypto.randomUUID();
    let file;
    if (input.ref) {
      file = sessionFile(input.ref);
      fs.copyFileSync(file, file + ".gitterm-" + Date.now());
    } else {
      const dir = path.join(sessionsDir, encode(cwd));
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, new Date().toISOString().replace(/[:.]/g, "-") + "_" + id + ".jsonl");
    }
    header.id = id;
    header.cwd = cwd;
    delete header.parentSession;
    lines[0] = JSON.stringify(header);
    fs.writeFileSync(file + ".gitterm-new", lines.join("\n"), { mode: 0o600 });
    fs.renameSync(file + ".gitterm-new", file);
    return { ref: id, file };
  },

  async notify() {
    const inbox = path.join(agentDir, "gitterm", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, input.ref + ".txt"), input.message, { mode: 0o600 });
    // In the cloud, open the session now, where the workspace's terminal attaches.
    if (input.where !== "cloud" || !has("tmux")) return { started: false };
    const file = sessionFile(input.ref);
    const cwd = entries(fs.readFileSync(file, "utf8"))[0].cwd;
    try { cp.execFileSync("tmux", ["kill-session", "-t", "${PI_TMUX_SESSION}"], { stdio: "ignore" }); } catch {}
    const pathEnv = path.join(home, ".local", "bin") + ":" + process.env.PATH;
    cp.execFileSync("tmux", ["new-session", "-d", "-s", "${PI_TMUX_SESSION}", "-c", cwd, "env", "PATH=" + pathEnv, piBin, "--session", file], { stdio: "ignore" });
    return { started: true };
  },

  async status() {
    return { busy: busy(input.ref) };
  },
};
`);

/** Whether a user message entry was added to a Pi session after its first `bytes` (UTF-8). */
export function piSentSince(session: string, bytes: number): boolean {
  return Buffer.from(session)
    .subarray(bytes)
    .toString("utf8")
    .split("\n")
    .some((line) => {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { role?: string } };
        return entry.type === "message" && entry.message?.role === "user";
      } catch {
        return false;
      }
    });
}

export const piAgent: AgentAdapter = {
  key: "pi",
  label: "Pi",
  installed: () => runs("pi", ["--version"]),
  howToMove: "Type /cloud in a session; /cloud-return brings it back.",
  script: PI_SCRIPT,
  session: scriptSession(PI_SCRIPT),
  // Pi gives its bash tool the session it runs in.
  currentSession: (env) => env.PI_SESSION_ID,
  sentSince: (exported: ExportedSession, mark) =>
    piSentSince(
      gunzipSync(Buffer.from(String(exported.payload.session), "base64")).toString("utf8"),
      mark,
    ),
  insideReturn:
    "Pi keeps this session open and would write over the returned one. Run /cloud-return in Pi instead (from `gitterm setup`), or quit Pi and run `gitterm return`.",

  /** Installs GitTerm's Pi extension: `/cloud`, `/cloud-return`, and moved-session notices. */
  async setup() {
    const dir =
      process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || homedir(), ".pi", "agent");
    const file = path.join(dir, PI_EXTENSION_PATH);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, PI_EXTENSION);
    return { changes: [`Installed GitTerm's Pi extension: ${file}`] };
  },
};
