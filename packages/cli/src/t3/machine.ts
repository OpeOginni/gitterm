import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RESULT_MARKER, T3_SCRIPT } from "./script.js";

/** Where a T3 Code server runs: this computer, or a cloud workspace reached through GitTerm. */
export interface Machine {
  /** Runs an operation of the T3 script there. Throws its error. */
  t3<T = Record<string, unknown>>(op: string, input?: Record<string, unknown>): Promise<T>;
  /** Runs a `node -e` style script (it reads its arguments from argv[1]) in a directory. */
  script(
    directory: string,
    script: string,
    args: string[],
  ): Promise<{ exit: number; stdout: string }>;
  writeFile(file: string, data: Buffer): Promise<void>;
  readFile(file: string): Promise<Buffer>;
  remove(file: string): Promise<void>;
}

export type Exec = (command: string) => Promise<{ exitCode: number; stdout: string }>;

/** `node -e` scripts read argv[1]; run from a file, that is the file. Drop it. */
const asFile = (script: string) => `process.argv.splice(1, 1);\n${script}`;

function parseResult<T>(stdout: string): T {
  const line = stdout.split("\n").findLast((item) => item.startsWith(RESULT_MARKER));
  if (!line) throw new Error(`The T3 script printed no result: ${stdout.trim().slice(-500)}`);
  const result = JSON.parse(line.slice(RESULT_MARKER.length)) as { ok: boolean; error?: string };
  if (!result.ok) throw new Error(result.error ?? "The T3 script failed");
  return result as T;
}

function run(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ exit: number; stdout: string }>((resolve) => {
    execFile(
      process.execPath,
      [file, ...args],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
        maxBuffer: 256 << 20,
        timeout: 300_000,
      },
      (error, stdout) =>
        resolve({
          exit: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout),
        }),
    );
  });
}

/** This computer. `env` points it at another T3 (tests use it for a second server). */
export function localMachine(env: NodeJS.ProcessEnv = {}): Machine {
  const withFile = async <T>(content: string, use: (file: string) => Promise<T>) => {
    const dir = path.join(tmpdir(), `gitterm-t3-${randomUUID()}`);
    await mkdir(dir, { mode: 0o700 });
    try {
      const file = path.join(dir, "script.js");
      await writeFile(file, content, { mode: 0o600 });
      return await use(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  return {
    t3: (op, input = {}) =>
      withFile(T3_SCRIPT, async (file) => {
        const inputFile = `${file}.json`;
        await writeFile(inputFile, JSON.stringify({ ...input, op }), { mode: 0o600 });
        return parseResult((await run(file, [inputFile], { env })).stdout);
      }),
    script: (directory, script, args) =>
      withFile(asFile(script), (file) => run(file, args, { cwd: directory, env })),
    writeFile: async (file, data) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data, { mode: 0o600 });
    },
    readFile: (file) => readFile(file),
    remove: (file) => rm(file, { recursive: true, force: true }),
  };
}

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const EXIT_MARKER = "__GITTERM_T3_EXIT__";
/** Under the API's 120 000 character limit and Linux's 128 KiB limit on one argument. */
const UPLOAD_CHUNK = 96_000;
const DOWNLOAD_CHUNK = 3 << 20;

/**
 * A workspace, through a command runner. Some providers throw on a non-zero exit, so every
 * command reports its own exit code. Files travel as base64, in one command when small.
 * Scripts are uploaded once per content and reused.
 */
export function remoteMachine(exec: Exec): Machine {
  const shell = async (command: string) => {
    const { stdout } = await exec(`{ ${command}\n} 2>&1; printf '\\n${EXIT_MARKER}%s\\n' "$?"`);
    const match = new RegExp(`\\n?${EXIT_MARKER}(\\d+)\\n?$`).exec(stdout);
    if (!match) throw new Error(`The workspace command did not finish: ${stdout.slice(-300)}`);
    return { exit: Number(match[1]), stdout: stdout.slice(0, match.index) };
  };
  const writeRemote = async (file: string, data: Buffer) => {
    const encoded = data.toString("base64");
    const target = quote(file);
    const parent = `mkdir -p ${quote(path.posix.dirname(file))}`;
    if (encoded.length <= UPLOAD_CHUNK) {
      const written = await shell(
        `${parent} && printf '%s' '${encoded}' | base64 -d > ${target} && chmod 600 ${target}`,
      );
      if (written.exit !== 0) throw new Error(`Could not write ${file} in the workspace`);
      return;
    }
    const staging = quote(`${file}.b64`);
    const prepared = await shell(`${parent} && : > ${staging}`);
    if (prepared.exit !== 0) throw new Error(`Could not write ${file} in the workspace`);
    for (let offset = 0; offset < encoded.length; offset += UPLOAD_CHUNK) {
      const part = await shell(
        `printf '%s' '${encoded.slice(offset, offset + UPLOAD_CHUNK)}' >> ${staging}`,
      );
      if (part.exit !== 0) throw new Error(`Could not upload ${file} to the workspace`);
    }
    const done = await shell(
      `base64 -d < ${staging} > ${target} && chmod 600 ${target} && rm -f ${staging}`,
    );
    if (done.exit !== 0) throw new Error(`Could not assemble ${file} in the workspace`);
  };
  const uploaded = new Map<string, Promise<string>>();
  const installed = (content: string) => {
    const file = `/tmp/gitterm-t3-${createHash("sha256").update(content).digest("hex").slice(0, 16)}.js`;
    if (!uploaded.has(file))
      uploaded.set(
        file,
        writeRemote(file, Buffer.from(content)).then(() => file),
      );
    return uploaded.get(file)!;
  };
  return {
    t3: async (op, input = {}) => {
      const script = quote(await installed(T3_SCRIPT));
      const encoded = Buffer.from(JSON.stringify({ ...input, op })).toString("base64");
      if (encoded.length <= UPLOAD_CHUNK) {
        const result = await shell(
          `(d=$(mktemp -d) && printf '%s' '${encoded}' | base64 -d > "$d/input.json" && node ${script} "$d/input.json"; s=$?; rm -rf "$d"; exit $s)`,
        );
        return parseResult(result.stdout);
      }
      const file = `/tmp/gitterm-t3-input-${randomUUID()}.json`;
      try {
        await writeRemote(file, Buffer.from(encoded, "base64"));
        return parseResult((await shell(`node ${script} ${quote(file)}`)).stdout);
      } finally {
        await shell(`rm -f ${quote(file)}`).catch(() => {});
      }
    },
    script: async (directory, script, args) => {
      const file = await installed(asFile(script));
      return shell(
        `cd ${quote(directory)} && GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 node ${quote(file)} ${args.map(quote).join(" ")}`,
      );
    },
    writeFile: writeRemote,
    readFile: async (file) => {
      const size = await shell(`wc -c < ${quote(file)}`);
      if (size.exit !== 0) throw new Error(`Could not read ${file} in the workspace`);
      const total = Number(size.stdout.trim().split("\n").pop());
      const parts: Buffer[] = [];
      for (let offset = 0; offset < total; offset += DOWNLOAD_CHUNK) {
        const part = await shell(
          `tail -c +${offset + 1} ${quote(file)} | head -c ${DOWNLOAD_CHUNK} | base64 | tr -d '\\n'`,
        );
        if (part.exit !== 0) throw new Error(`Could not download ${file} from the workspace`);
        parts.push(Buffer.from(part.stdout.trim().split("\n").pop() ?? "", "base64"));
      }
      const data = Buffer.concat(parts);
      if (data.length !== total) throw new Error(`Downloading ${file} was incomplete`);
      return data;
    },
    remove: async (file) => {
      await shell(`rm -rf ${quote(file)}`);
    },
  };
}
