import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { agentScript, scriptSession } from "../script.js";
import type { AgentAdapter, ExportedSession } from "./types.js";

/**
 * T3 Code threads that run Claude Code. A thread's session is Claude Code's own session file
 * (`<claude home>/projects/<cwd with non-alphanumerics as ->/<session id>.jsonl`), which T3
 * in the workspace imports as a thread through its API.
 *
 * Its script talks to T3 only through its own CLI and API: `t3 auth session issue` for a
 * short-lived token, the HTTP API for threads and projects, and the WebSocket RPC for
 * session import. Beyond the common operations it has `enableLinks`, `pair` and
 * `clientLink`, which link a workspace to this machine's T3 Code.
 */
const T3_SCRIPT = agentScript(String.raw`
const base = process.env.T3CODE_HOME || path.join(home, ".t3");
const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");

function findT3() {
  const candidates = [input.t3, process.env.T3CODE_CLI_PATH];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) if (dir) candidates.push(path.join(dir, "t3"));
  candidates.push(path.join(home, ".t3", "bin", "t3"), path.join(home, ".local", "bin", "t3"));
  for (const candidate of candidates) {
    try { if (candidate && fs.statSync(candidate).isFile()) { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } } catch {}
  }
  fail("T3 Code's t3 command was not found. Install T3 Code, or set T3CODE_CLI_PATH.");
}
const t3bin = findT3();
const t3 = (...args) => cp.execFileSync(t3bin, [...args, "--base-dir", base], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });

function server() {
  let runtime;
  try { runtime = JSON.parse(fs.readFileSync(path.join(base, "userdata", "server-runtime.json"), "utf8")); } catch {}
  if (!runtime || !runtime.origin) fail("No T3 Code server is running for " + base + ".");
  return runtime.origin;
}
let session;
async function api(method, pathname, body) {
  const origin = server();
  session = session || t3("auth", "session", "issue", "--scope", "orchestration:read", "--scope", "orchestration:operate", "--ttl", "10m", "--label", "gitterm", "--token-only").trim();
  const response = await fetch(origin + pathname, {
    method,
    headers: { authorization: "Bearer " + session, "x-t3-orchestration-protocol": "2", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) { const error = new Error("T3 " + method + " " + pathname + ": HTTP " + response.status); error.status = response.status; throw error; }
  return response.json();
}
async function rpc(tag, payload) {
  const { ticket } = await api("POST", "/api/auth/websocket-ticket/rpc");
  const url = new URL("/ws", server());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("orchestrationProtocol", "2");
  url.searchParams.set("wsTicket", ticket);
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("T3 " + tag + " timed out")); }, 120000);
    socket.onopen = () => socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }));
    socket.onerror = () => reject(new Error("T3 " + tag + ": WebSocket error"));
    socket.onmessage = (event) => {
      for (const message of [JSON.parse(String(event.data))].flat()) {
        if (message._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
        if (message._tag !== "Exit" || message.requestId !== "1") continue;
        clearTimeout(timer);
        socket.close();
        if (message.exit._tag === "Success") resolve(message.exit.value);
        else reject(new Error("T3 " + tag + " failed: " + JSON.stringify(message.exit).slice(0, 500)));
      }
    };
  });
}
const environment = () => fetch(server() + "/.well-known/t3/environment").then((response) => response.json());
const enc = (value) => encodeURIComponent(value);
const sanitize = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");

function settings(change) {
  const file = path.join(base, "userdata", "settings.json");
  let value = {};
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (!change(value)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".gitterm", JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(file + ".gitterm", file);
  return true;
}

/** The thread's state and the native session behind it. */
async function thread(threadId) {
  const { projection } = await api("GET", "/api/orchestration/threads/" + enc(threadId));
  const current = projection.thread;
  const providerThreads = projection.providerThreads || [];
  const provider = providerThreads.find((item) => item.id === current.activeProviderThreadId && item.nativeThreadRef)
    || providerThreads.filter((item) => item.nativeThreadRef).sort((a, b) => (b.lastRunOrdinal || 0) - (a.lastRunOrdinal || 0))[0];
  const busy = (projection.runs || []).some((run) => ["preparing", "queued", "starting", "running", "waiting"].includes(run.status));
  return { thread: current, native: provider && provider.nativeThreadRef, busy, title: current.title, model: current.modelSelection && current.modelSelection.model };
}

function sessionFile(sessionId) {
  const projects = path.join(claudeHome, "projects");
  for (const dir of fs.existsSync(projects) ? fs.readdirSync(projects) : []) {
    const file = path.join(projects, dir, sessionId + ".jsonl");
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Rewrites only the records' session id and working directory; history stays as it was. */
function rewrite(text, sessionId, cwd) {
  return text.split("\n").map((line) => {
    if (!line.trim()) return line;
    let record;
    try { record = JSON.parse(line); } catch { return line; }
    if (typeof record.sessionId === "string") record.sessionId = sessionId;
    if (typeof record.cwd === "string") record.cwd = cwd;
    return JSON.stringify(record);
  }).join("\n");
}

async function projectFor(cwd) {
  const shell = await api("GET", "/api/orchestration/shell");
  const found = (shell.projects || []).find((project) => !project.archivedAt && real(project.workspaceRoot) === real(cwd));
  if (found) return found.id;
  const added = /^Added project (\S+) /m.exec(t3("project", "add", cwd));
  if (!added) fail("T3 Code did not create a project for " + cwd + ".");
  return added[1];
}

const ops = {
  /** This server's identity and version. */
  async info() {
    const env = await environment();
    return { version: env.serverVersion, environmentId: env.environmentId, label: env.label };
  },

  /** Turns on Linked environments, so this server can link and accept links. */
  async enableLinks() {
    return { changed: settings((value) => value.linkedEnvironmentsEnabled !== true && (value.linkedEnvironmentsEnabled = true)) };
  },

  /** A one-time pairing code for this server and the project for a checkout, for linking it. */
  async pair() {
    settings((value) => value.linkedEnvironmentsEnabled !== true && (value.linkedEnvironmentsEnabled = true));
    const scopes = input.access === "read-only" ? ["orchestration:read"]
      : input.access === "full-access" ? ["orchestration:read", "orchestration:operate", "settings:write", "source-control:write"]
      : ["orchestration:read", "orchestration:operate"];
    const created = JSON.parse(t3("auth", "pairing", "create", "--json", "--ttl", "10m", "--label", input.label || "gitterm", ...scopes.flatMap((scope) => ["--scope", scope])));
    const env = await environment();
    return { pairingCode: created.credential, projectId: input.cwd ? await projectFor(input.cwd) : undefined, environmentId: env.environmentId, serverVersion: env.serverVersion };
  },

  /** A one-time link that signs a T3 Code app in to this server. */
  async clientLink() {
    const created = JSON.parse(t3("auth", "pairing", "create", "--json", "--ttl", "30m", "--label", input.label || "gitterm", "--base-url", input.baseUrl));
    return { url: created.pairingUrl || created.url || input.baseUrl + "/pair#token=" + enc(created.credential) };
  },

  /** The thread's native session, compressed, with the directory it ran in. */
  async export() {
    const state = await thread(input.ref);
    if (!state.native) fail("This thread has no agent session yet. Send it a message first.");
    if (state.native.driver !== "claudeAgent") fail("Only Claude Code threads can move between machines so far; this one runs " + state.native.driver + ".");
    if (state.busy && !input.allowBusy) fail("The thread is still working. Let it finish or stop it, then try again.");
    const file = sessionFile(state.native.nativeId);
    if (!file) fail("Claude Code's session file for this thread was not found under " + claudeHome + ".");
    const text = fs.readFileSync(file, "utf8");
    let cwd = null;
    for (const line of text.split("\n")) { try { const record = JSON.parse(line); if (typeof record.cwd === "string") cwd = record.cwd; } catch {} }
    if (!cwd) fail("The session file does not say which directory it ran in.");
    const memory = {};
    const memoryDir = path.join(path.dirname(file), "memory");
    for (const name of fs.existsSync(memoryDir) ? fs.readdirSync(memoryDir) : []) {
      const entry = path.join(memoryDir, name);
      if (fs.statSync(entry).isFile() && fs.statSync(entry).size < 256 * 1024) memory[name] = fs.readFileSync(entry, "utf8");
    }
    return {
      ref: input.ref,
      cwd,
      title: state.title,
      mark: Buffer.byteLength(text),
      payload: {
        providerInstanceId: state.thread.providerInstanceId,
        session: zlib.gzipSync(text).toString("base64"),
        memory,
      },
    };
  },

  /**
   * Writes a session for cwd. With "ref" it replaces that thread's own session (keeping a
   * copy of the old one); otherwise it imports the session as a new thread here.
   */
  async import() {
    const cwd = real(input.cwd);
    const payload = input.payload;
    let text = zlib.gunzipSync(Buffer.from(payload.session, "base64")).toString("utf8");
    let sessionId = crypto.randomUUID();
    let target = null;
    if (input.ref) {
      const state = await thread(input.ref);
      if (state.busy) fail("The thread here is working. Let it finish or stop it, then try again.");
      if (!state.native || state.native.driver !== "claudeAgent") fail("The thread here has no Claude Code session to replace.");
      sessionId = state.native.nativeId;
      target = sessionFile(sessionId);
      // T3 keeps a thread's agent process for 30 idle minutes and continues from its memory,
      // not the file. Release it so the next turn resumes from the session written here.
      await rpc("orchestration.forceStopThread", { threadId: input.ref }).catch(() => {});
    }
    text = rewrite(text, sessionId, cwd);
    const dir = path.join(claudeHome, "projects", sanitize(cwd));
    fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
    for (const [name, content] of Object.entries(payload.memory || {})) {
      const file = path.join(dir, "memory", path.basename(name));
      if (!fs.existsSync(file)) fs.writeFileSync(file, content);
    }
    const file = target || path.join(dir, sessionId + ".jsonl");
    let kept = null;
    if (fs.existsSync(file)) {
      kept = file + ".gitterm-" + Date.now();
      fs.copyFileSync(file, kept);
    }
    fs.writeFileSync(file + ".gitterm-new", text, { mode: 0o600 });
    fs.renameSync(file + ".gitterm-new", file);
    if (input.ref) return { ref: input.ref, kept };

    const projectId = await projectFor(cwd);
    // Import works from the last scan, so scan first or a new session file is not seen.
    await rpc("agentSessions.scan", {});
    await rpc("agentSessions.import", { projectId });
    const threadId = "import:" + (payload.providerInstanceId || "claudeAgent") + ":" + sessionId;
    try { await api("GET", "/api/orchestration/threads/" + enc(threadId)); }
    catch (error) { fail("T3 Code did not import the moved session" + (error.status === 404 ? "." : ": " + error.message)); }
    return { ref: threadId, projectId };
  },

  /** Starts a run in a thread with a message; does not wait for it. */
  async notify() {
    t3("thread", "send", input.ref, input.message);
    return {};
  },

  /** Whether a thread is working. */
  async status() {
    const state = await thread(input.ref);
    return { busy: state.busy, title: state.title };
  },
};

`);

/** This machine's T3 Code: its data directory and CLI, as the T3 script finds them. */
export function t3BaseDir(): string {
  return process.env.T3CODE_HOME || path.join(homedir(), ".t3");
}

export function t3Binary(): string {
  const candidates = [process.env.T3CODE_CLI_PATH];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter))
    if (dir) candidates.push(path.join(dir, "t3"));
  candidates.push(path.join(homedir(), ".t3", "bin", "t3"));
  for (const candidate of candidates) {
    try {
      if (candidate && statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      /* Not this one. */
    }
  }
  throw new Error("T3 Code's t3 command was not found. Install T3 Code, or set T3CODE_CLI_PATH.");
}

function t3(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      t3Binary(),
      [...args, "--base-dir", t3BaseDir()],
      { encoding: "utf8", timeout: 180_000, maxBuffer: 16 << 20 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const detail = `${stderr}\n${stdout}`
          .split("\n")
          .find((line) => /error/i.test(line) && !/electron|CompileAndCall/.test(line));
        reject(
          new Error(`t3 ${args.slice(0, 2).join(" ")} failed${detail ? `: ${detail.trim()}` : ""}`),
        );
      },
    ),
  );
}

export type LinkedEnvironment = {
  environmentId: string;
  label: string;
  urls: string[];
  status: string;
};

export async function linkedEnvironments(): Promise<LinkedEnvironment[]> {
  return JSON.parse(await t3(["environment", "list", "--json"])) as LinkedEnvironment[];
}

/** Links the environment at url to this machine's T3 Code, so its agents can work there. */
export async function linkEnvironment(url: string, pairingCode: string, access: string) {
  await t3(["environment", "link", url, "--pairing-code", pairingCode, "--access", access]);
  const origin = new URL(url).origin;
  const linked = (await linkedEnvironments()).find((environment) =>
    environment.urls.some((item) => URL.canParse(item) && new URL(item).origin === origin),
  );
  if (!linked) throw new Error(`Linked ${url}, but T3 Code does not list it`);
  return linked;
}

export async function unlinkEnvironment(environmentId: string) {
  await t3(["environment", "unlink", environmentId]);
}

/** A thread link T3 Code renders as a chip and opens, through a link when it is elsewhere. */
export const threadLink = (environmentId: string, threadId: string) =>
  `t3-thread://v2/${environmentId}/${encodeURIComponent(threadId)}`;

/** Whether a real user message was added to a Claude Code session after `bytes`. */
export function sentSince(session: string, bytes: number): boolean {
  return session
    .slice(bytes)
    .split("\n")
    .some((line) => {
      try {
        const record = JSON.parse(line) as {
          type?: string;
          isMeta?: boolean;
          isSidechain?: boolean;
          message?: { content?: unknown };
        };
        if (record.type !== "user" || record.isMeta || record.isSidechain) return false;
        const content = record.message?.content;
        if (typeof content === "string") return content.trim().length > 0;
        return (
          Array.isArray(content) &&
          content.some((block: { type?: string }) => block.type === "text") &&
          !content.some((block: { type?: string }) => block.type === "tool_result")
        );
      } catch {
        return false;
      }
    });
}

const sessionText = (exported: ExportedSession) =>
  gunzipSync(Buffer.from(String(exported.payload.session), "base64")).toString("utf8");

export const t3Agent: AgentAdapter = {
  key: "t3code",
  label: "T3 Code",
  script: T3_SCRIPT,
  session: scriptSession(T3_SCRIPT),
  currentSession: (env) => env.T3CODE_THREAD_ID,
  sentSince: (exported, mark) => sentSince(sessionText(exported), mark),

  async setup(local) {
    const linked = await local.agent<{ changed: boolean }>(T3_SCRIPT, "enableLinks");
    return linked.changed ? ["Turned on Linked environments in T3 Code."] : [];
  },

  /** Links the workspace to this machine's T3 Code, so the moved thread opens from here. */
  async connect({ local, remote, url, cwd, ref }) {
    const warnings: string[] = [];
    const access = "full-access";
    const paired = await remote.agent<{ pairingCode: string }>(T3_SCRIPT, "pair", { access, cwd });
    const linked = await linkEnvironment(url, paired.pairingCode, access);
    const links: Record<string, string> = {};
    const there = await remote.agent<{ environmentId: string }>(T3_SCRIPT, "info");
    links["Cloud thread"] = threadLink(there.environmentId, ref);
    try {
      links["Open in a T3 Code app (one-time link)"] = (
        await remote.agent<{ url: string }>(T3_SCRIPT, "clientLink", { baseUrl: url })
      ).url;
    } catch {
      /* The thread link still works through the linked environment. */
    }
    void local;
    return { links, warnings, state: { linkedEnvironmentId: linked.environmentId } };
  },

  async disconnect(state) {
    if (state.linkedEnvironmentId) await unlinkEnvironment(state.linkedEnvironmentId);
  },

  async link(local, ref) {
    const here = await local.agent<{ environmentId: string }>(T3_SCRIPT, "info");
    return threadLink(here.environmentId, ref);
  },
};

/**
 * A workspace linked to this machine's T3 Code, for its agents to hand tasks to with
 * `delegate_task`. Nothing moves: the workspace clones the pushed branch.
 */
export async function pairEnvironment(
  remote: import("../machine.js").Machine,
  input: { url: string; cwd: string; access: string },
) {
  const paired = await remote.agent<{ pairingCode: string; projectId: string }>(T3_SCRIPT, "pair", {
    access: input.access,
    cwd: input.cwd,
  });
  const linked = await linkEnvironment(input.url, paired.pairingCode, input.access);
  return { environmentId: linked.environmentId, projectId: paired.projectId };
}

/** Unlinks the environment at url from this machine's T3 Code, if it is linked. */
export async function unpairEnvironment(url: string) {
  const origin = new URL(url).origin;
  const linked = (await linkedEnvironments().catch(() => [])).find((environment) =>
    environment.urls.some((item) => URL.canParse(item) && new URL(item).origin === origin),
  );
  if (linked) await unlinkEnvironment(linked.environmentId);
}
