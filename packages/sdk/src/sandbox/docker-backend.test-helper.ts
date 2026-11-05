import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createExecServerClient,
  EXEC_SERVER_PORT,
  EXEC_SERVER_SOURCE,
  execServerToken,
} from "@gitterm/agent-runtime/sandbox/exec-server";
import type { SandboxTransport } from "@gitterm/agent-runtime/sandbox/types";
import type { SandboxBackend, SandboxInfo } from "./backend.js";
import { SandboxProviderError } from "@gitterm/agent-runtime/sandbox/types";
import { createDirectSandboxBackend, SandboxAccountError } from "./backend.js";

/**
 * A local Docker container standing in for a provider sandbox, for tests of the job
 * runner, source sync, and artifacts against real Linux tools. Not end-to-end proof of
 * any provider. Previews map container port 8000 to a loopback port.
 */
export const DOCKER_TEST_IMAGE = "node:22-bookworm-slim";

function docker(
  args: string[],
  input?: Uint8Array,
  timeoutMs = 120_000,
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
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

export function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => execFile("docker", ["info"], (error) => resolve(!error)));
}

export function createDockerSandboxBackend(account: string, runLabel: string): SandboxBackend {
  const identity = { mode: "direct" as const, provider: "e2b" as const, account };
  const home = "/home/user";
  const inspect = async (id: string): Promise<SandboxInfo> => {
    const result = await docker(["inspect", id]);
    if (result.code !== 0)
      return {
        ...identity,
        id,
        state: "terminated",
        name: null,
        createdAt: null,
        expiresAt: null,
        labels: {},
      };
    const [container] = JSON.parse(result.stdout.toString()) as Array<{
      Created: string;
      State: { Running: boolean };
      Config: { Labels: Record<string, string> };
    }>;
    const labels = container!.Config.Labels ?? {};
    if (labels.gitterm_account !== account)
      throw new SandboxAccountError(
        `Sandbox ${id} was not created by direct account ${JSON.stringify(account)}.`,
      );
    return {
      ...identity,
      id,
      state: container!.State.Running ? "running" : "terminated",
      name: labels.gitterm_name ?? null,
      createdAt: container!.Created,
      expiresAt: null,
      labels,
    };
  };
  const running = async (id: string) => {
    if ((await inspect(id)).state !== "running")
      throw new SandboxProviderError("not_found", "gone");
  };
  return {
    identity,
    home,
    capabilities: {
      expiry: "hard",
      previews: "private",
      pause: "stateful",
      maxLifetimeMs: 24 * 60 * 60_000,
    },
    async create(input) {
      const labels = {
        ...input.labels,
        gitterm_account: account,
        gitterm_name: input.name,
        gitterm_test_run: runLabel,
      };
      const result = await docker([
        "run",
        "-d",
        ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
        "-p",
        "127.0.0.1::8000",
        DOCKER_TEST_IMAGE,
        "sleep",
        String(Math.ceil(input.lifetimeMs / 1000)),
      ]);
      if (result.code !== 0) throw new Error(`docker run failed: ${result.stderr}`);
      const id = result.stdout.toString().trim();
      const setup = await docker([
        "exec",
        id,
        "sh",
        "-c",
        "useradd -m -s /bin/sh user && mkdir -p /home/user/project && chown -R user /home/user",
      ]);
      if (setup.code !== 0) {
        await docker(["rm", "-f", id]);
        throw new Error(`container setup failed: ${setup.stderr}`);
      }
      return inspect(id);
    },
    get: inspect,
    async list() {
      const result = await docker([
        "ps",
        "-q",
        "--no-trunc",
        "--filter",
        `label=gitterm_account=${account}`,
        "--filter",
        `label=gitterm_test_run=${runLabel}`,
      ]);
      return Promise.all(result.stdout.toString().split("\n").filter(Boolean).map(inspect));
    },
    async destroy(id) {
      await inspect(id);
      await docker(["rm", "-f", id]);
    },
    async run(id, command, options = {}) {
      await running(id);
      const result = await docker(
        [
          "exec",
          "-u",
          "user",
          ...(options.cwd ? ["-w", options.cwd] : []),
          ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
          id,
          "sh",
          "-c",
          command,
        ],
        undefined,
        options.timeoutMs ?? 60_000,
      );
      return { exitCode: result.code, stdout: result.stdout.toString(), stderr: result.stderr };
    },
    async writeFile(id, path, data) {
      await running(id);
      const result = await docker(
        [
          "exec",
          "-i",
          "-u",
          "user",
          id,
          "sh",
          "-c",
          'mkdir -p "$(dirname "$1")" && cat > "$1"',
          "sh",
          path,
        ],
        data,
      );
      if (result.code !== 0) throw new Error(`write failed: ${result.stderr}`);
    },
    async readFile(id, path) {
      await running(id);
      const result = await docker(["exec", "-u", "user", id, "cat", path]);
      if (result.code !== 0) throw new Error(`read failed: ${result.stderr}`);
      return new Uint8Array(result.stdout);
    },
    async preview(id) {
      await running(id);
      const result = await docker(["port", id, "8000/tcp"]);
      const address = result.stdout.toString().trim().split("\n")[0];
      return { url: `http://${address}`, headers: {} };
    },
  };
}

/**
 * A container reachable only through the Gitterm command server, exactly as Railway and
 * AWS sandboxes are: commands, files, and previews all go over HTTP with the derived token.
 */
export function createExecServerDockerBackend(account: string, runLabel: string): SandboxBackend {
  const credential = "local-test-credential";
  const transport: SandboxTransport = {
    provider: "railway",
    home: "/root",
    capabilities: {
      expiry: "none",
      previews: "private",
      pause: "state-losing",
      maxLifetimeMs: 86_400_000,
    },
    async create(input) {
      const name = `gitterm-sbx-${randomBytes(4).toString("hex")}`;
      const result = await docker([
        "run",
        "-d",
        "--label",
        `gitterm_labels=${JSON.stringify(input.labels)}`,
        "--label",
        `gitterm_name=${name}`,
        "--label",
        `gitterm_test_run=${runLabel}`,
        "-p",
        `127.0.0.1::${EXEC_SERVER_PORT}`,
        "-e",
        `PORT=${EXEC_SERVER_PORT}`,
        "-e",
        `GITTERM_EXEC_TOKEN=${execServerToken(credential, name)}`,
        "-e",
        `GITTERM_EXEC_SERVER=${EXEC_SERVER_SOURCE}`,
        DOCKER_TEST_IMAGE,
        "sh",
        "-c",
        'node -e "$GITTERM_EXEC_SERVER"',
      ]);
      if (result.code !== 0) throw new Error(`docker run failed: ${result.stderr}`);
      const id = result.stdout.toString().trim();
      const deadline = Date.now() + 30_000;
      while (!(await (await client(id)).ready())) {
        if (Date.now() > deadline) throw new Error("command server did not start");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return transport.info(id);
    },
    async info(id) {
      const result = await docker(["inspect", id]);
      if (result.code !== 0)
        return { id, state: "terminated", labels: {}, startedAt: null, expiresAt: null };
      const [container] = JSON.parse(result.stdout.toString()) as Array<{
        State: { Running: boolean };
        Config: { Labels: Record<string, string> };
      }>;
      return {
        id,
        state: container!.State.Running ? "running" : "terminated",
        labels: JSON.parse(container!.Config.Labels.gitterm_labels ?? "{}"),
        startedAt: null,
        expiresAt: null,
      };
    },
    async list() {
      const result = await docker([
        "ps",
        "-q",
        "--no-trunc",
        "--filter",
        `label=gitterm_test_run=${runLabel}`,
      ]);
      return Promise.all(
        result.stdout
          .toString()
          .split("\n")
          .filter(Boolean)
          .map((id) => transport.info(id)),
      );
    },
    async destroy(id) {
      await docker(["rm", "-f", id]);
    },
    pause: async () => {},
    resume: async () => {},
    run: async (id, command, options) => (await client(id)).run(command, options),
    writeFile: async (id, path, data) => (await client(id)).writeFile(path, data),
    readFile: async (id, path) => (await client(id)).readFile(path),
    preview: async (id, port) => (await client(id)).preview(port),
  };
  async function client(id: string) {
    const inspected = JSON.parse((await docker(["inspect", id])).stdout.toString()) as Array<{
      Config: { Labels: Record<string, string> };
    }>;
    const address = (await docker(["port", id, `${EXEC_SERVER_PORT}/tcp`])).stdout
      .toString()
      .trim()
      .split("\n")[0];
    return createExecServerClient(
      `http://${address}`,
      execServerToken(credential, inspected[0]!.Config.Labels.gitterm_name!),
      "test",
    );
  }
  return createDirectSandboxBackend({ account, transport, allowUnboundedLifetime: true });
}
