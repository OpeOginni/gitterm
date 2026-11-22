/**
 * One self-contained Node script that runs wherever a T3 Code server lives: on this machine,
 * or in a cloud workspace through `workspace.execCommand`. Keeping it a plain script means the
 * workspace needs nothing installed but Node and T3, whatever CLI version it has.
 *
 * `node script.js <input.json>`; the input names an `op`. It prints one line,
 * `GITTERM_T3_RESULT <json>`, with `{ ok: true, ... }` or `{ ok: false, error }`.
 *
 * It talks to T3 only through its own CLI and API: `t3 auth session issue` for a short-lived
 * token, the HTTP API for threads and projects, and the WebSocket RPC for session import.
 * The one thing outside T3 is the agent's native session file: Claude Code's
 * `<claude home>/projects/<cwd with non-alphanumerics as ->/<session id>.jsonl`.
 */
export const RESULT_MARKER = "GITTERM_T3_RESULT ";

export const T3_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const home = os.homedir();
const base = process.env.T3CODE_HOME || path.join(home, ".t3");
const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
const fail = (error) => { throw Object.assign(new Error(error), { report: error }); };

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
const real = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };

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
    return { environmentId: env.environmentId, label: env.label, serverVersion: env.serverVersion };
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
    const state = await thread(input.threadId);
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
      provider: "claudeAgent",
      providerInstanceId: state.thread.providerInstanceId,
      sessionId: state.native.nativeId,
      cwd,
      title: state.title,
      model: state.model,
      bytes: Buffer.byteLength(text),
      digest: crypto.createHash("sha256").update(text).digest("hex"),
      session: zlib.gzipSync(text).toString("base64"),
      memory,
    };
  },

  /**
   * Writes a session for cwd. With "threadId" it replaces that thread's own session (keeping a
   * copy of the old one); otherwise it imports the session as a new thread here.
   */
  async import() {
    const cwd = real(input.cwd);
    let text = zlib.gunzipSync(Buffer.from(input.session, "base64")).toString("utf8");
    let sessionId = crypto.randomUUID();
    let target = null;
    if (input.threadId) {
      const state = await thread(input.threadId);
      if (state.busy) fail("The thread here is working. Let it finish or stop it, then try again.");
      if (!state.native || state.native.driver !== "claudeAgent") fail("The thread here has no Claude Code session to replace.");
      sessionId = state.native.nativeId;
      target = sessionFile(sessionId);
      // T3 keeps a thread's agent process for 30 idle minutes and continues from its memory,
      // not the file. Release it so the next turn resumes from the session written here.
      await rpc("orchestration.forceStopThread", { threadId: input.threadId }).catch(() => {});
    }
    text = rewrite(text, sessionId, cwd);
    const dir = path.join(claudeHome, "projects", sanitize(cwd));
    fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
    for (const [name, content] of Object.entries(input.memory || {})) {
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
    const env = await environment();
    if (input.threadId) return { threadId: input.threadId, sessionId, kept, environmentId: env.environmentId };

    const projectId = await projectFor(cwd);
    // Import works from the last scan, so scan first or a new session file is not seen.
    await rpc("agentSessions.scan", {});
    await rpc("agentSessions.import", { projectId });
    const threadId = "import:" + (input.providerInstanceId || "claudeAgent") + ":" + sessionId;
    try { await api("GET", "/api/orchestration/threads/" + enc(threadId)); }
    catch (error) { fail("T3 Code did not import the moved session" + (error.status === 404 ? "." : ": " + error.message)); }
    return { threadId, projectId, sessionId, environmentId: env.environmentId, serverVersion: env.serverVersion };
  },

  /** Starts a run in a thread with a message; does not wait for it. */
  async send() {
    t3("thread", "send", input.threadId, input.message);
    return { threadId: input.threadId };
  },

  /** Whether a thread is working. */
  async status() {
    const state = await thread(input.threadId);
    return { busy: state.busy, title: state.title };
  },
};

(async () => {
  const op = ops[input.op];
  if (!op) fail("Unknown operation " + input.op);
  return { ok: true, ...(await op()) };
})().then(
  (result) => process.stdout.write("\n${RESULT_MARKER}" + JSON.stringify(result) + "\n"),
  (error) => {
    process.stdout.write("\n${RESULT_MARKER}" + JSON.stringify({ ok: false, error: error.report || String(error && error.message || error) }) + "\n");
    process.exitCode = 1;
  },
);
`;
