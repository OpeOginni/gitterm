import { execFile, spawn } from "node:child_process";
import {
  SandboxProviderError,
  terminated,
  type SandboxProviderKey,
  type SandboxTransport,
} from "./types";

/**
 * Docker containers standing in for a provider's sandboxes, for tests of agent workspaces
 * against a real runtime image and agent. Containers run the image's own user and `HOME`, with
 * `sleep` in place of its entrypoint; port 4096 is published to a loopback port. Stopping a
 * container kills its processes, like a provider whose pause keeps only the disk.
 */
export const DOCKER_RUNTIME_IMAGE =
  process.env.GITTERM_RUNTIME_IMAGE ?? "gitterm-release-local-opencode:verify";

/** Docker tests are opt-in: GITTERM_SANDBOX_DOCKER_TESTS=1 with Docker running. */
export function dockerTestsEnabled(): Promise<boolean> {
  if (process.env.GITTERM_SANDBOX_DOCKER_TESTS !== "1") return Promise.resolve(false);
  return new Promise((resolve) => execFile("docker", ["info"], (error) => resolve(!error)));
}

function docker(args: string[], input?: Uint8Array, timeoutMs = 300_000) {
  return new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn("docker", args);
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: err });
    });
    child.stdin.end(input ? Buffer.from(input) : undefined);
  });
}

async function must(args: string[], input?: Uint8Array) {
  const result = await docker(args, input);
  if (result.code !== 0) throw new SandboxProviderError("provider", result.stderr.trim());
  return result.stdout.toString();
}

/**
 * Containers labelled `gitterm_test_run=<run>`, posing as `provider` (its profile's home and
 * workspace root apply), with no resume command.
 */
export function createDockerTransport(
  run: string,
  provider: SandboxProviderKey = "daytona",
  home = "/home/daytona",
): SandboxTransport {
  return {
    provider,
    home,
    capabilities: {
      expiry: "hard",
      previews: "private",
      pause: "stateful",
      maxLifetimeMs: 24 * 60 * 60_000,
      snapshots: "none",
    },
    async create(input) {
      const id = (
        await must([
          "run",
          "-d",
          "--label",
          `gitterm_test_run=${run}`,
          ...Object.entries(input.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
          "-p",
          "127.0.0.1::4096",
          "--entrypoint",
          "sleep",
          input.template!,
          "infinity",
        ])
      ).trim();
      return { id, state: "running", labels: input.labels, startedAt: null, expiresAt: null };
    },
    async info(id) {
      const result = await docker(["inspect", "-f", "{{.State.Running}}", id]);
      if (result.code !== 0) return terminated(id);
      const state = result.stdout.toString().trim() === "true" ? "running" : "paused";
      return { id, state, labels: {}, startedAt: null, expiresAt: null };
    },
    async list() {
      return [];
    },
    async destroy(id) {
      await must(["rm", "-f", id]);
    },
    async pause(id) {
      await must(["stop", "-t", "1", id]);
    },
    async resume(id) {
      await must(["start", id]);
    },
    async run(id, command, options = {}) {
      const result = await docker(
        ["exec", ...(options.cwd ? ["-w", options.cwd] : []), id, "bash", "-c", command],
        undefined,
        options.timeoutMs ?? 60_000,
      );
      return { exitCode: result.code, stdout: result.stdout.toString(), stderr: result.stderr };
    },
    async writeFile(id, path, data) {
      await must(
        ["exec", "-i", id, "sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path],
        data,
      );
    },
    async readFile(id, path) {
      return new Uint8Array(Buffer.from(await must(["exec", id, "cat", path])));
    },
    async preview(id, port) {
      const address = (await must(["port", id, `${port}/tcp`])).trim().split("\n")[0];
      return { url: `http://${address}`, headers: {} };
    },
  };
}

/** Deletes every container of a test run. */
export async function removeDockerRun(run: string): Promise<void> {
  const ids = (await must(["ps", "-aq", "--filter", `label=gitterm_test_run=${run}`])).split("\n");
  for (const id of ids.filter(Boolean)) await docker(["rm", "-f", id]);
}
