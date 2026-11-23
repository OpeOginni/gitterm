import { afterAll, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createDockerTransport,
  DOCKER_RUNTIME_IMAGE,
  dockerTestsEnabled,
  removeDockerRun,
} from "@gitterm/agent-runtime/sandbox/docker.test-helper";
import { npmInstallCommand } from "@gitterm/schema/agent-install";
import { opencodeProvisioner } from "../service/agents/opencode";
import * as transportModule from "../service/sandbox-transport";
import * as timeouts from "../service/workspace-timeouts";
import { withSandboxHandles } from "./sandbox-handles";
import { TransportWorkspaceProvider } from "./transport-workspace";

/**
 * A workspace on a provider that is nothing but a `SandboxTransport`: a local Docker
 * container running the GitTerm runtime image, provisioned by the real OpenCode
 * provisioner through `TransportWorkspaceProvider`, set up as Daytona is. The image sets
 * `HOME=/workspace` while Daytona's profile says `/home/daytona`, so the agent's files must
 * follow the image. Stopping the container kills the agent, like Daytona's stop, so the
 * resume must start it again.
 *
 * Opt in: GITTERM_SANDBOX_DOCKER_TESTS=1 bun test src/providers/transport-workspace.docker.test.ts
 * The image defaults to a locally built runtime image; set GITTERM_RUNTIME_IMAGE to another.
 */
const IMAGE = DOCKER_RUNTIME_IMAGE;
const RUN = `transport-workspace-${randomBytes(4).toString("hex")}`;
const enabled = await dockerTestsEnabled();
const transport = createDockerTransport(RUN);

const mocks = [
  spyOn(transportModule, "managedSandboxTransport").mockResolvedValue(transport),
  spyOn(timeouts, "getWorkspaceIdleTimeoutMs").mockResolvedValue(30 * 60_000),
];
afterAll(async () => {
  mocks.forEach((mock) => mock.mockRestore());
  if (enabled) await removeDockerRun(RUN);
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
      new TransportWorkspaceProvider("daytona", { label: "Docker" }),
    );
    const info = await provider.createWorkspace({
      workspaceId: "ws1",
      userId: "u1",
      imageId: "image",
      subdomain: "ws1",
      imageProviderMetadata: { daytona: { image: IMAGE } },
      provisioningSpec: {
        agent,
        repo: { url: "https://github.com/octocat/Hello-World", name: "hello" },
        workspaceProfile: "standard",
        editorAccessEnabled: false,
      },
    });
    const id = info.externalServiceId.replace("sandbox:daytona:", "");

    expect(await answers(info.upstreamUrl, password)).toBe(200);
    // The checkout and the agent's files are where the agent looks for them.
    const checkout = await transport.run(id, "git -C /workspace/hello log --oneline | wc -l");
    expect(Number(checkout.stdout.trim())).toBeGreaterThan(0);
    expect(
      (await transport.run(id, "test -s /workspace/.config/opencode/opencode.json")).exitCode,
    ).toBe(0);

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

test.skipIf(!enabled)(
  "a plain image without Node gets the agent from its setup commands, as E2B's base does",
  async () => {
    const password = randomBytes(12).toString("hex");
    const provider = withSandboxHandles(
      new TransportWorkspaceProvider("daytona", { label: "Docker" }),
    );
    const info = await provider.createWorkspace({
      workspaceId: "ws2",
      userId: "u1",
      imageId: "image",
      subdomain: "ws2",
      imageProviderMetadata: {
        daytona: {
          image: "buildpack-deps:bookworm-scm",
          setupCommands: [npmInstallCommand(["@opencode/cli@2"])],
        },
      },
      provisioningSpec: {
        agent: opencodeProvisioner.provision({
          userId: "u1",
          userDisplayName: "Test",
          workspaceHostname: "ws2.localhost",
          agentTypeName: "OpenCode",
          serverOnly: true,
          serverPassword: password,
          credentials: [],
        }),
        repo: { url: "https://github.com/octocat/Hello-World", name: "hello" },
        workspaceProfile: "standard",
        editorAccessEnabled: false,
      },
    });
    expect(await answers(info.upstreamUrl, password)).toBe(200);
    const id = info.externalServiceId.replace("sandbox:daytona:", "");
    // Node and the agent went to ~/.local; the resume finds them there too.
    await provider.pauseWorkspace(info.externalServiceId);
    await provider.resumeWorkspace(info.externalServiceId);
    expect(await answers((await transport.preview(id, 4096)).url, password)).toBe(200);
    await provider.terminateWorkspace(info.externalServiceId);
  },
  900_000,
);
