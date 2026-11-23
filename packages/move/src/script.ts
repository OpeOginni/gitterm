/**
 * Every agent's operations run as one self-contained Node script, on this machine or in a
 * workspace through `workspace.execCommand`, so a workspace needs nothing but Node and the
 * agent itself.
 *
 * `node script.js <input.json>`; the input names an `op`. The script prints one line,
 * `GITTERM_AGENT_RESULT <json>`, with `{ ok: true, ... }` or `{ ok: false, error }`.
 *
 * The operations every agent provides:
 * - `info` → `{ version }`
 * - `export { ref, allowBusy }` → an `ExportedSession`
 * - `import { payload, cwd, ref? }` → `{ ref }`. With `ref`, replaces that session in place.
 * - `notify { ref, message, where }` → starts the agent on the message, without waiting.
 *   `where` is `cloud` or `local`.
 * - `status { ref }` → `{ busy }`
 */
import type { Machine } from "./machine.js";
import type { ExportedSession, SessionOps } from "./agents/types.js";

export const RESULT_MARKER = "GITTERM_AGENT_RESULT ";

/** An agent's session operations, run by its script on the machine. */
export function scriptSession(script: string) {
  return (machine: Machine): SessionOps => ({
    info: () => machine.agent<{ version: string }>(script, "info"),
    export: (input) => machine.agent<ExportedSession>(script, "export", input),
    import: (input) => machine.agent<{ ref: string }>(script, "import", input),
    notify: async (input) => void (await machine.agent(script, "notify", input)),
    status: (input) => machine.agent<{ busy: boolean }>(script, "status", input),
  });
}

/**
 * Wraps an agent's operations into a script. `body` defines `const ops = { ... }`; each op is
 * an async function of `input`, and `fail(message)` reports an error the user can act on.
 */
export function agentScript(body: string): string {
  return String.raw`
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const home = os.homedir();
const fail = (error) => { throw Object.assign(new Error(error), { report: error }); };
const real = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };
${body}
(async () => {
  const op = ops[input.op];
  if (!op) fail("Unknown operation " + input.op);
  return { ok: true, ...(await op()) };
})().then(
  (result) => process.stdout.write("\n${RESULT_MARKER}" + JSON.stringify(result) + "\n"),
  (error) => {
    process.stdout.write("\n${RESULT_MARKER}" + JSON.stringify({ ok: false, error: error.report || String((error && error.message) || error) }) + "\n");
    process.exitCode = 1;
  },
);
`;
}
