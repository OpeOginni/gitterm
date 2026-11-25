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
 * - `notify { ref, message }` → starts the agent on the message, without waiting.
 * - `status { ref }` → `{ busy }`
 */
export const RESULT_MARKER = "GITTERM_AGENT_RESULT ";

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
