import { afterAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDockerTransport,
  dockerTestsEnabled,
  removeDockerRun,
} from "@gitterm/agent-runtime/sandbox/docker.test-helper";
import { provisionWorkspace } from "@gitterm/agent-runtime/sandbox/workspace";
import {
  PI_EXTENSION,
  PI_EXTENSION_PATH,
  PI_INSTALL_COMMAND,
  piServeCommand,
} from "@gitterm/schema/pi";
import { localMachine, remoteMachine } from "../machine.js";
import type { ExportedSession } from "./types.js";
import { piAgent } from "./pi.js";

/**
 * A Pi workspace as GitTerm provisions one, on a Docker container posing as a provider: the
 * seeded install command on a plain Node 24 image, Pi in a password-protected browser
 * terminal, and a session moved in from this machine, which starts in the workspace's tmux
 * and receives its notice. No model is called successfully: the workspace Pi has no
 * credentials, so the notice's turn fails after Pi receives it.
 *
 * Opt in: GITTERM_SANDBOX_DOCKER_TESTS=1 bun test src/move/agents/pi.docker.test.ts
 */
const RUN = `pi-workspace-${randomBytes(4).toString("hex")}`;
const enabled = await dockerTestsEnabled();
const transport = createDockerTransport(RUN);
const local = realpathSync(mkdtempSync(path.join(tmpdir(), "gitterm-pi-docker-")));
afterAll(async () => {
  rmSync(local, { recursive: true, force: true });
  if (enabled) await removeDockerRun(RUN);
});

const ID = "11111111-2222-4333-8444-555555555555";

test.skipIf(!enabled)(
  "a Pi workspace serves Pi behind its password and runs a moved session",
  async () => {
    const password = randomBytes(12).toString("hex");
    const workspace = await provisionWorkspace(transport, {
      create: {
        labels: { gitterm_workspace: "pi" },
        timeoutMs: 30 * 60_000,
        onTimeout: "pause",
        template: "node:24-bookworm",
        env: { PI_WEB_PASSWORD: password, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" },
      },
      setupCommands: [PI_INSTALL_COMMAND],
      name: "repo",
      files: [
        {
          path: `~/.pi/agent/${PI_EXTENSION_PATH}`,
          contentBase64: Buffer.from(PI_EXTENSION).toString("base64"),
        },
      ],
      serve: { command: piServeCommand(4096), port: 4096 },
    });

    // The terminal needs the workspace password, as GitTerm's clients send it.
    expect((await fetch(workspace.preview.url)).status).toBe(401);
    const page = await fetch(workspace.preview.url, {
      headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
    });
    expect(page.status).toBe(200);

    // A session from this machine moves in and starts in the tmux the terminal attaches to.
    const agentDir = path.join(local, "agent");
    const cwd = path.join(local, "repo");
    const sessions = path.join(agentDir, "sessions", `--${cwd.slice(1).replace(/[/\\:]/g, "-")}--`);
    mkdirSync(sessions, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      path.join(sessions, `2026-11-23T10-00-00-000Z_${ID}.jsonl`),
      [
        { type: "session", version: 3, id: ID, timestamp: "2026-11-23T10:00:00.000Z", cwd },
        {
          type: "message",
          id: "a1b2c3d4",
          parentId: null,
          timestamp: "2026-11-23T10:00:00.000Z",
          message: { role: "user", content: "The test word is KIWI-7.", timestamp: 1 },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );
    const exported = await localMachine({ PI_CODING_AGENT_DIR: agentDir }).agent<ExportedSession>(
      piAgent.script!,
      "export",
      { ref: ID },
    );
    const remote = remoteMachine(async (command) => {
      const result = await transport.run(workspace.id, command, { timeoutMs: 300_000 });
      return { exitCode: result.exitCode, stdout: result.stdout };
    });
    const info = await remote.agent<{ version: string }>(piAgent.script!, "info");
    expect(info.version).toMatch(/\d+\.\d+\.\d+/);
    const imported = await remote.agent<{ ref: string }>(piAgent.script!, "import", {
      payload: exported.payload,
      cwd: workspace.directory,
    });
    const notified = await remote.agent<{ started: boolean }>(piAgent.script!, "notify", {
      ref: imported.ref,
      message: "GITTERM-NOTICE",
      where: "cloud",
    });
    expect(notified.started).toBe(true);
    expect((await transport.run(workspace.id, "tmux has-session -t pi")).exitCode).toBe(0);
    // Pi opened the session in tmux and its GitTerm extension took the notice.
    const inbox = `$HOME/.pi/agent/gitterm/inbox/${imported.ref}.txt`;
    let delivered = false;
    for (let i = 0; i < 60 && !delivered; i++) {
      delivered = (await transport.run(workspace.id, `[ ! -f "${inbox}" ]`)).exitCode === 0;
      if (!delivered) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(delivered).toBe(true);
  },
  900_000,
);
