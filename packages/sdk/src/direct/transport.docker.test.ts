import { afterAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createDockerTransport,
  DOCKER_RUNTIME_IMAGE,
  dockerTestsEnabled,
  removeDockerRun,
} from "@gitterm/agent-runtime/sandbox/docker.test-helper";
import { createDirectGittermClient } from "./client";
import { createTransportDirectProvider } from "./transport";

/**
 * A direct workspace (the caller's own provider, no Gitterm server) on a Docker container
 * posing as a Daytona sandbox, through the generic transport adapter and the real client:
 * OpenCode from the runtime image, a checkout, pause and resume, and terminate.
 *
 * Opt in: GITTERM_SANDBOX_DOCKER_TESTS=1 bun test src/direct/transport.docker.test.ts
 */
const RUN = `direct-workspace-${randomBytes(4).toString("hex")}`;
const enabled = await dockerTestsEnabled();
const transport = createDockerTransport(RUN);

afterAll(async () => {
  if (enabled) await removeDockerRun(RUN);
});

test.skipIf(!enabled)(
  "a direct workspace runs the agent on any transport and survives a pause",
  async () => {
    const client = createDirectGittermClient({
      provider: createTransportDirectProvider({
        name: "daytona",
        capabilities: {
          persistence: "supported",
          recommendedLifecycle: "persistent",
          supportsPause: true,
          ephemeralPause: "stateful",
          supportsKeepAlive: false,
        },
        transport,
        template: async () => DOCKER_RUNTIME_IMAGE,
        timeoutMs: 30 * 60_000,
      }),
    });
    const workspace = await client.workspaces.create({
      repo: "https://github.com/octocat/Hello-World",
      lifecycle: "persistent",
      setup: { beforeAgent: ["git log --oneline -1 > .before-agent"] },
    });
    expect(workspace.status).toBe("running");
    expect(workspace.runtime.directory).toBe("/workspace/Hello-World");
    const ran = await transport.run(
      workspace.externalId,
      "cat /workspace/Hello-World/.before-agent && test -s /workspace/.config/opencode/opencode.json",
    );
    expect(ran.exitCode).toBe(0);

    const paused = await client.workspaces.pause(workspace);
    expect(paused.status).toBe("paused");
    const resumed = await client.workspaces.resume(paused);
    expect(resumed.status).toBe("running");
    // The client checked the agent answers with its password before returning.
    expect(resumed.runtime.url).toStartWith("http://127.0.0.1:");

    await client.workspaces.terminate(resumed);
    expect((await transport.info(workspace.externalId)).state).toBe("terminated");
  },
  600_000,
);
