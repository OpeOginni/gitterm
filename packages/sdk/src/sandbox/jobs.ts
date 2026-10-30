import { randomBytes } from "node:crypto";
import type { SandboxBackend } from "./backend.js";

/**
 * Durable jobs. State lives in the sandbox (`~/.gitterm/jobs/<id>`), so any process holding
 * the sandbox reference can reattach: a plugin restart loses nothing.
 *
 * The command runs in its own session/process group. Cancellation and the timeout
 * signal that whole group, and status reports whether the group is actually alive.
 */

export const jobRoot = (home: string) => `${home}/.gitterm/jobs`;

export type JobStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled" | "lost";

export type JobState = {
  id: string;
  status: JobStatus;
  /** The command's exit code. A non-zero code is a command failure, not a provider failure. */
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Whether any process of the job's group is still running in the sandbox. */
  processAlive: boolean;
  logBytes: number;
};

export type JobStartInput = {
  command: string;
  /** Absolute directory in the sandbox. */
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
};

const q = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export function newJobId(): string {
  return `job_${randomBytes(10).toString("hex")}`;
}

function jobDir(backend: SandboxBackend, id: string): string {
  if (!/^job_[a-f0-9]{20}$/.test(id)) throw new Error(`Invalid job id: ${id}`);
  return `${jobRoot(backend.home)}/${id}`;
}

const NOW = "date -u +%Y-%m-%dT%H:%M:%S.%3NZ";

/**
 * Liveness that ignores zombies: `kill -0` also succeeds for unreaped processes.
 * `group_alive G` checks a process group, `pid_alive P` a single process.
 */
const LIVENESS = `group_alive() {
  g=$1
  for s in /proc/[0-9]*/stat; do
    read -r line < "$s" 2>/dev/null || continue
    set -- \${line##*) }
    [ "$3" = "$g" ] || continue
    [ "$1" = Z ] || return 0
  done
  return 1
}
pid_alive() {
  read -r line < "/proc/$1/stat" 2>/dev/null || return 1
  set -- \${line##*) }
  [ "$1" != Z ]
}`;

/** Runs detached from the launching call. Args: job dir, timeout seconds, cwd. */
const RUNNER = `J="$1"; T="$2"; C="$3"
echo $$ > "$J/runner.pid"
exec > "$J/output.log" 2>&1 < /dev/null
finish() { ${NOW} > "$J/finished"; echo "$1" > "$J/exit.tmp"; mv "$J/exit.tmp" "$J/exit"; exit "$1"; }
cd "$C" 2>/dev/null || { echo "gitterm: working directory not found: $C"; finish 127; }
setsid -w sh -c 'echo $$ > "$0/pgid"; . "$0/env.sh"; exec sh "$0/command.sh"' "$J" &
child=$!
setsid sh -c 'sleep "$1"; [ -e "$0/exit" ] && exit 0; : > "$0/timed_out"; P=$(cat "$0/pgid"); kill -TERM -"$P" 2>/dev/null; sleep 10; kill -KILL -"$P" 2>/dev/null' "$J" "$T" > /dev/null 2>&1 &
dog=$!
wait "$child"; code=$?
kill -TERM -"$dog" 2>/dev/null || kill "$dog" 2>/dev/null
finish "$code"
`;

function envScript(env: Record<string, string> = {}): string {
  return Object.entries(env)
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid variable name: ${key}`);
      return `export ${key}=${q(value)}`;
    })
    .join("\n");
}

export async function startJob(
  backend: SandboxBackend,
  sandboxId: string,
  id: string,
  input: JobStartInput,
): Promise<void> {
  const dir = jobDir(backend, id);
  const seconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
  const prepared = await backend.run(
    sandboxId,
    `mkdir -p ${q(dir)} && chmod 700 ${q(dir)} && [ ! -e ${q(`${dir}/started`)} ]`,
    { timeoutMs: 30_000 },
  );
  if (prepared.exitCode !== 0) throw new Error(`Could not prepare job ${id} in the sandbox`);
  // Values are written to a 0600 file inside the sandbox, not passed on a command line.
  await backend.writeFile(sandboxId, `${dir}/env.sh`, Buffer.from(envScript(input.env)));
  await backend.writeFile(sandboxId, `${dir}/command.sh`, Buffer.from(input.command));
  await backend.writeFile(sandboxId, `${dir}/runner.sh`, Buffer.from(RUNNER));
  const launched = await backend.run(
    sandboxId,
    [
      `set -e`,
      `cd ${q(dir)}`,
      `chmod 600 env.sh`,
      `[ ! -e started ] || { echo "job already started" >&2; exit 17; }`,
      `${NOW} > started`,
      `nohup setsid sh runner.sh ${q(dir)} ${seconds} ${q(input.cwd)} > /dev/null 2>&1 < /dev/null &`,
      `echo started`,
    ].join("\n"),
    { timeoutMs: 30_000 },
  );
  if (launched.exitCode !== 0)
    throw new Error(`Could not start the job in the sandbox (exit ${launched.exitCode})`);
}

export async function readJobState(
  backend: SandboxBackend,
  sandboxId: string,
  id: string,
): Promise<JobState | null> {
  const dir = jobDir(backend, id);
  const result = await backend.run(
    sandboxId,
    [
      LIVENESS,
      `J=${q(dir)}`,
      `[ -e "$J/started" ] || { echo missing=1; exit 0; }`,
      `echo "started=$(cat "$J/started")"`,
      `echo "finished=$(cat "$J/finished" 2>/dev/null)"`,
      `echo "exit=$(cat "$J/exit" 2>/dev/null)"`,
      `[ ! -e "$J/cancelled" ] || echo cancelled=1`,
      `[ ! -e "$J/timed_out" ] || echo timed_out=1`,
      `P=$(cat "$J/pgid" 2>/dev/null || true)`,
      `[ -z "$P" ] || ! group_alive "$P" || echo group_alive=1`,
      `R=$(cat "$J/runner.pid" 2>/dev/null || true)`,
      `[ -z "$R" ] || ! pid_alive "$R" || echo runner_alive=1`,
      `echo "log_bytes=$(wc -c < "$J/output.log" 2>/dev/null || echo 0)"`,
    ].join("\n"),
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) throw new Error("Could not read job state from the sandbox");
  const values = Object.fromEntries(
    result.stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  );
  if (values.missing) return null;
  const exitCode = values.exit ? Number(values.exit) : null;
  const status: JobStatus =
    exitCode !== null
      ? values.cancelled
        ? "cancelled"
        : values.timed_out
          ? "timed_out"
          : exitCode === 0
            ? "succeeded"
            : "failed"
      : values.runner_alive
        ? "running"
        : // The runner is gone without recording an exit, e.g. the sandbox restarted.
          "lost";
  return {
    id,
    status,
    exitCode,
    startedAt: values.started || null,
    finishedAt: values.finished || null,
    processAlive: Boolean(values.group_alive),
    logBytes: Number(values.log_bytes) || 0,
  };
}

/** Reads `limit` bytes of combined stdout/stderr starting at `offset`. */
export async function readJobLog(
  backend: SandboxBackend,
  sandboxId: string,
  id: string,
  offset: number,
  limit: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid log offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024 * 1024)
    throw new Error("Log reads are limited to 1 MiB");
  const result = await backend.run(
    sandboxId,
    `tail -c +${offset + 1} ${q(`${jobDir(backend, id)}/output.log`)} 2>/dev/null | head -c ${limit} | base64 | tr -d '\\n'`,
    { timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) throw new Error("Could not read the job log");
  return Buffer.from(result.stdout.trim(), "base64");
}

/** Signals the job's process group: TERM, then KILL after `graceSeconds`. */
export async function cancelJob(
  backend: SandboxBackend,
  sandboxId: string,
  id: string,
  graceSeconds = 5,
): Promise<void> {
  const dir = jobDir(backend, id);
  const result = await backend.run(
    sandboxId,
    [
      LIVENESS,
      `J=${q(dir)}`,
      `[ -e "$J/started" ] || { echo "unknown job" >&2; exit 3; }`,
      `[ ! -e "$J/exit" ] || exit 0`,
      `: > "$J/cancelled"`,
      `P=$(cat "$J/pgid" 2>/dev/null || true)`,
      `[ -n "$P" ] || exit 0`,
      `kill -TERM -"$P" 2>/dev/null || true`,
      `i=0; while [ $i -lt ${graceSeconds * 10} ] && group_alive "$P"; do sleep 0.1; i=$((i+1)); done`,
      `kill -KILL -"$P" 2>/dev/null || true`,
      `i=0; while [ $i -lt 50 ] && [ ! -e "$J/exit" ]; do sleep 0.1; i=$((i+1)); done`,
    ].join("\n"),
    { timeoutMs: (graceSeconds + 15) * 1000 },
  );
  if (result.exitCode === 3) throw new Error(`Unknown job ${id}`);
  if (result.exitCode !== 0) throw new Error("Could not cancel the job");
}
