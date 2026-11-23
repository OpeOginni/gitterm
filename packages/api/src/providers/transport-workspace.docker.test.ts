import { afterAll, expect, spyOn, test } from "bun:test";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  SandboxProviderError,
  terminated,
  type SandboxTransport,
} from "@gitterm/agent-runtime/sandbox/types";
import { opencodeProvisioner } from "../service/agents/opencode";
import * as transportModule from "../service/sandbox-transport";
import * as timeouts from "../service/workspace-timeouts";
import { withSandboxHandles } from "./sandbox-handles";
import { TransportWorkspaceProvider } from "./transport-workspace";

/**
 * A workspace on a provider that is nothing but a `SandboxTransport`: a local Docker
 * container running the GitTerm runtime image, provisioned by the real OpenCode
 * provisioner through `TransportWorkspaceProvider`. Stopping the container kills the agent,
 * like a provider whose pause keeps only the disk, so the resume must start it again.
 *
 * Opt in: GITTERM_SANDBOX_DOCKER_TESTS=1 bun test src/providers/transport-workspace.docker.test.ts
 * The image defaults to a locally built runtime image; set GITTERM_RUNTIME_IMAGE to another.
 */
const IMAGE = process.env.GITTERM_RUNTIME_IMAGE ?? "gitterm-release-local-opencode:verify";
const RUN = `transport-workspace-${randomBytes(4).toString("hex")}`;
const enabled =
  process.env.GITTERM_SANDBOX_DOCKER_TESTS === "1" &&
  (await new Promise((resolve) => execFile("docker", ["info"], (error) => resolve(!error))));

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

/** Like Railway: home `/root`, the agent's ports published, and no resume command. */
const transport: SandboxTransport = {
  provider: "railway",
  home: "/root",
  capabilities: {
    expiry: "none",
    previews: "private",
    pause: "state-losing",
    maxLifetimeMs: 24 * 60 * 60_000,
    snapshots: "none",
  },
  async create(input) {
    const id = (
      await must([
        "run",
        "-d",
        "--label",
        `gitterm_test_run=${RUN}`,
        ...Object.entries(input.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        "-e",
        "HOME=/root",
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

const mocks = [
  spyOn(transportModule, "managedSandboxTransport").mockResolvedValue(transport),
  spyOn(timeouts, "getWorkspaceIdleTimeoutMs").mockResolvedValue(30 * 60_000),
];
afterAll(async () => {
  mocks.forEach((mock) => mock.mockRestore());
  const ids = (await must(["ps", "-aq", "--filter", `label=gitterm_test_run=${RUN}`])).split("\n");
  for (const id of ids.filter(Boolean)) await docker(["rm", "-f", id]);
});

/** The agent answers HTTP on its preview URL; OpenCode asks for its password. */
async function answers(url: string, password: string) {
  const response = await fetch(url, {
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
  });
  return response.status;
}

test.skipIf(!enabled)(
  "a provider that is only a transport hosts a real agent workspace and restarts it on resume",
  async () => {
    const password = randomBytes(12).toString("hex");
    const agent = opencodeProvisioner.provision({
      userId: "u1",
      userDisplayName: "Test",
      workspaceHostname: "ws1.localhost",
      agentTypeName: "OpenCode",
      serverOnly: true,
      serverPassword: password,
      credentials: [],
    });
    const provider = withSandboxHandles(
      new TransportWorkspaceProvider("railway", { label: "Docker" }),
    );
    const info = await provider.createWorkspace({
      workspaceId: "ws1",
      userId: "u1",
      imageId: "image",
      subdomain: "ws1",
      imageProviderMetadata: { railway: { image: IMAGE } as never },
      provisioningSpec: {
        agent,
        repo: { url: "https://github.com/octocat/Hello-World", name: "hello" },
        workspaceProfile: "standard",
        editorAccessEnabled: false,
      },
    });
    const id = info.externalServiceId.replace("sandbox:railway:", "");

    expect(await answers(info.upstreamUrl, password)).toBe(200);
    // The checkout and the agent's files are where the agent looks for them.
    const checkout = await transport.run(id, "git -C /root/workspace/hello log --oneline | wc -l");
    expect(Number(checkout.stdout.trim())).toBeGreaterThan(0);
    expect((await transport.run(id, "test -s /root/.config/opencode/opencode.json")).exitCode).toBe(
      0,
    );

    // Stopping the container stops the agent; the resume starts it again.
    await provider.pauseWorkspace(info.externalServiceId);
    await provider.resumeWorkspace(info.externalServiceId);
    const resumed = await transport.preview(id, 4096);
    expect(await answers(resumed.url, password)).toBe(200);

    await provider.terminateWorkspace(info.externalServiceId);
    expect((await transport.info(id)).state).toBe("terminated");
  },
  600_000,
);
