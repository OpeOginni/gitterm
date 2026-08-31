import { Sandbox } from "@vercel/sandbox";
import { setupCommandScript, shellQuote, waitForDirectRuntime } from "./provisioning.js";
import type { DirectProviderAdapter, VercelDirectProviderConfig } from "./types.js";

const WORKSPACE_ROOT = "/vercel/sandbox";

type VercelHandle = {
  name: string;
  directory: string;
  command: string;
  port: number;
};

function parseHandle(externalId: string): VercelHandle {
  const handle = JSON.parse(externalId) as Partial<VercelHandle>;
  if (
    typeof handle.name !== "string" ||
    typeof handle.directory !== "string" ||
    typeof handle.command !== "string" ||
    typeof handle.port !== "number"
  ) {
    throw new Error("Invalid Vercel direct workspace handle");
  }
  return handle as VercelHandle;
}

export function createVercelDirectProvider(
  config: VercelDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiToken.trim()) throw new Error("Vercel apiToken is required");
  if (!config.teamId.trim()) throw new Error("Vercel teamId is required");
  if (!config.projectId.trim()) throw new Error("Vercel projectId is required");

  const credentials = {
    token: config.apiToken,
    teamId: config.teamId,
    projectId: config.projectId,
  };
  const getSandbox = async (externalId: string, resume: boolean) => {
    const handle = parseHandle(externalId);
    const sandbox = await Sandbox.get({ name: handle.name, resume, ...credentials });
    return { handle, sandbox };
  };
  const run = async (
    sandbox: Awaited<ReturnType<typeof Sandbox.get>>,
    command: string,
    cwd?: string,
    env?: Record<string, string>,
  ) => {
    const result = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", command],
      cwd,
      env,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Vercel command failed with exit code ${result.exitCode}: ${(await result.stderr()).trim() || command}`,
      );
    }
  };
  const startAgent = async (
    sandbox: Awaited<ReturnType<typeof Sandbox.get>>,
    handle: VercelHandle,
  ) => {
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `exec ${handle.command} > /tmp/gitterm-agent.log 2>&1`],
      cwd: handle.directory,
      detached: true,
    });
  };

  return {
    name: "vercel",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "persistent",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    async create(input) {
      const plan = input.provisioning;
      const handle: VercelHandle = {
        name: `gitterm-${input.id}`,
        directory: `${WORKSPACE_ROOT}/${plan.repository?.name ?? "workspace"}`,
        command: plan.agent.command,
        port: plan.agent.port,
      };
      const sandbox = await Sandbox.create({
        ...credentials,
        name: handle.name,
        persistent: true,
        keepLastSnapshots: { count: 1 },
        ports: [handle.port],
        env: plan.agent.environmentVariables,
        timeout: config.timeoutMs ?? 10 * 60_000,
        tags: { gitterm_workspace: input.id },
        ...(config.image ? { image: config.image } : { runtime: config.runtime ?? "node24" }),
        ...(config.vcpus != null ? { resources: { vcpus: config.vcpus } } : {}),
      });

      try {
        await run(sandbox, `mkdir -p ${shellQuote(handle.directory)}`);
        for (const command of config.runtimeSetupCommands ??
          (config.image ? [] : ["npm install -g opencode-ai --no-audit --fund=false"])) {
          await run(sandbox, command);
        }
        if (plan.repository) {
          const repository = plan.repository;
          const url = repository.url.endsWith(".git") ? repository.url : `${repository.url}.git`;
          const askPassPath = "/tmp/gitterm-git-askpass";
          if (repository.authToken) {
            await sandbox.writeFiles([
              {
                path: askPassPath,
                mode: 0o700,
                content:
                  '#!/bin/sh\ncase "$1" in\n  *Username*) printf \'%s\\n\' "$GITTERM_GIT_USERNAME" ;;\n  *) printf \'%s\\n\' "$GITTERM_GIT_TOKEN" ;;\nesac\n',
              },
            ]);
          }
          try {
            const ref = repository.checkoutRef ?? repository.branch;
            await run(
              sandbox,
              `git clone${ref ? ` --branch ${shellQuote(ref)}` : ""} ${shellQuote(url)} ${shellQuote(handle.directory)}`,
              undefined,
              repository.authToken
                ? {
                    GIT_ASKPASS: askPassPath,
                    GIT_TERMINAL_PROMPT: "0",
                    GITTERM_GIT_USERNAME: repository.authUsername ?? "x-access-token",
                    GITTERM_GIT_TOKEN: repository.authToken,
                  }
                : undefined,
            );
          } finally {
            if (repository.authToken) {
              await sandbox.runCommand("rm", ["-f", askPassPath]).catch(() => undefined);
            }
          }
          if (repository.baseCommit) {
            await run(
              sandbox,
              `git fetch --depth 1 origin ${shellQuote(repository.baseCommit)} && git checkout --detach ${shellQuote(repository.baseCommit)}`,
              handle.directory,
            );
          }
        }
        const homeResult = await sandbox.runCommand("printenv", ["HOME"]);
        const home = (await homeResult.stdout()).trim() || "/home/vercel-sandbox";
        for (const file of plan.agent.files) {
          const target = file.path.replace(/^~/, home);
          const parent = target.slice(0, target.lastIndexOf("/"));
          await run(sandbox, `mkdir -p ${shellQuote(parent)}`);
          await sandbox.writeFiles([
            { path: target, content: Buffer.from(file.contentBase64, "base64") },
          ]);
        }
        if (plan.setupCommands.length) {
          await run(sandbox, setupCommandScript(plan.setupCommands), handle.directory);
        }
        await startAgent(sandbox, handle);
        const runtime = {
          url: sandbox.domain(handle.port),
          directory: handle.directory,
          password: input.password,
        };
        await waitForDirectRuntime(runtime);
        return { externalId: JSON.stringify(handle), runtime };
      } catch (error) {
        await sandbox.delete().catch(() => undefined);
        throw error;
      }
    },
    async status(workspace) {
      try {
        const { sandbox } = await getSandbox(workspace.externalId, false);
        if (sandbox.status === "running") return "running";
        if (["pending", "stopping", "snapshotting"].includes(sandbox.status)) return "pending";
        if (sandbox.status === "stopped") return "paused";
        if (sandbox.status === "failed") return "failed";
        return "terminated";
      } catch (error) {
        if (error instanceof Error && /not found|404|does not exist/i.test(error.message)) {
          return "terminated";
        }
        throw error;
      }
    },
    async pause(workspace) {
      const { sandbox } = await getSandbox(workspace.externalId, false);
      if (sandbox.status !== "stopped") await sandbox.stop();
    },
    async resume(workspace) {
      const handle = parseHandle(workspace.externalId);
      const sandbox = await Sandbox.get({
        name: handle.name,
        resume: true,
        ...credentials,
        onResume: async (resumed) => startAgent(resumed, handle),
      });
      const runtime = {
        ...workspace.runtime,
        url: sandbox.domain(handle.port),
        directory: handle.directory,
      };
      await waitForDirectRuntime(runtime);
      return runtime;
    },
    async terminate(workspace) {
      const { sandbox } = await getSandbox(workspace.externalId, false);
      await sandbox.delete();
    },
    async keepAlive(workspace, timeoutMs) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("Vercel keep-alive timeout must be positive");
      }
      const { sandbox } = await getSandbox(workspace.externalId, false);
      await sandbox.update({ timeout: timeoutMs });
    },
  };
}
