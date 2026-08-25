import { Daytona, Image } from "@daytonaio/sdk";
import { shellQuote, waitForDirectRuntime } from "./provisioning.js";
import type { DaytonaDirectProviderConfig, DirectProviderAdapter } from "./types.js";

const WORKSPACE_ROOT = "/workspace";
const AGENT_SESSION_ID = "gitterm-direct-agent";
const DEFAULT_IMAGE = "opeoginni/gitterm-opencode-server:latest";

type DaytonaHandle = {
  id: string;
  directory: string;
  command: string;
  port: number;
};

function parseHandle(externalId: string): DaytonaHandle {
  const handle = JSON.parse(externalId) as Partial<DaytonaHandle>;
  if (
    typeof handle.id !== "string" ||
    typeof handle.directory !== "string" ||
    typeof handle.command !== "string" ||
    typeof handle.port !== "number"
  ) {
    throw new Error("Invalid Daytona direct workspace handle");
  }
  return handle as DaytonaHandle;
}

export function createDaytonaDirectProvider(
  config: DaytonaDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("Daytona apiKey is required");
  if (!config.target.trim()) throw new Error("Daytona target is required");

  const client = () => new Daytona({ apiKey: config.apiKey, target: config.target });
  const getSandbox = async (externalId: string) => {
    const handle = parseHandle(externalId);
    return { handle, sandbox: await client().get(handle.id) };
  };
  const execute = async (
    sandbox: Awaited<ReturnType<Daytona["get"]>>,
    command: string,
    cwd?: string,
  ) => {
    const result = await sandbox.process.executeCommand(command, cwd);
    if (result.exitCode !== 0) {
      throw new Error(
        `Daytona command failed with exit code ${result.exitCode}: ${result.result ?? command}`,
      );
    }
  };
  const startAgent = async (
    sandbox: Awaited<ReturnType<Daytona["get"]>>,
    handle: DaytonaHandle,
  ) => {
    await sandbox.process.createSession(AGENT_SESSION_ID).catch(() => undefined);
    await sandbox.process.executeSessionCommand(AGENT_SESSION_ID, {
      command: `cd ${shellQuote(handle.directory)}`,
    });
    await sandbox.process.executeSessionCommand(AGENT_SESSION_ID, {
      command: `${handle.command} > /tmp/gitterm-agent.log 2>&1`,
      runAsync: true,
    });
  };
  const runtimeFor = async (
    sandbox: Awaited<ReturnType<Daytona["get"]>>,
    handle: DaytonaHandle,
    password: string | undefined,
  ) => {
    const preview = await sandbox.getPreviewLink(handle.port);
    return {
      url: preview.url,
      directory: handle.directory,
      password,
      ...(preview.token
        ? {
            headers: {
              "x-daytona-preview-token": preview.token,
              "X-Daytona-Skip-Preview-Warning": "true",
            },
          }
        : {}),
    };
  };

  return {
    name: "daytona",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "persistent",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    async create(input) {
      const plan = input.provisioning;
      const directory = `${WORKSPACE_ROOT}/${plan.repository?.name ?? "workspace"}`;
      const handle: DaytonaHandle = {
        id: "",
        directory,
        command: plan.agent.command,
        port: plan.agent.port,
      };
      const common = {
        name: `gitterm-${input.id}`,
        envVars: plan.agent.environmentVariables,
        labels: { gitterm_workspace: input.id },
        autoDeleteInterval: input.lifecycle === "ephemeral" ? 0 : -1,
      };
      const sandbox = await client().create(
        {
          ...common,
          image: Image.base(config.image ?? DEFAULT_IMAGE).entrypoint(["sleep", "infinity"]),
          resources: {
            ...(config.cpu != null ? { cpu: config.cpu } : {}),
            ...(config.memory != null ? { memory: config.memory } : {}),
            ...(config.disk != null ? { disk: config.disk } : {}),
          },
        },
        { timeout: 210 },
      );
      handle.id = sandbox.id;

      try {
        await execute(sandbox, `mkdir -p ${shellQuote(directory)}`);
        if (plan.repository) {
          const repository = plan.repository;
          const url = repository.url.endsWith(".git") ? repository.url : `${repository.url}.git`;
          await sandbox.git.clone(
            url,
            directory,
            repository.checkoutRef ?? repository.branch,
            undefined,
            repository.authToken ? (repository.authUsername ?? "x-access-token") : undefined,
            repository.authToken,
          );
          if (repository.baseCommit) {
            await execute(
              sandbox,
              `git fetch --depth 1 origin ${shellQuote(repository.baseCommit)} && git checkout --detach ${shellQuote(repository.baseCommit)}`,
              directory,
            );
          }
        }
        const home = (await sandbox.getUserHomeDir()) ?? "/home/daytona";
        for (const file of plan.agent.files) {
          const target = file.path.replace(/^~/, home);
          const parent = target.slice(0, target.lastIndexOf("/"));
          await execute(
            sandbox,
            `mkdir -p ${shellQuote(parent)} && printf %s ${shellQuote(file.contentBase64)} | base64 -d > ${shellQuote(target)}`,
          );
        }
        if (plan.setupCommands.length) {
          await execute(sandbox, plan.setupCommands.join(" && "), directory);
        }
        await startAgent(sandbox, handle);
        const runtime = await runtimeFor(sandbox, handle, input.password);
        await waitForDirectRuntime(runtime);
        return { externalId: JSON.stringify(handle), runtime };
      } catch (error) {
        await sandbox.delete().catch(() => undefined);
        throw error;
      }
    },
    async status(workspace) {
      try {
        const { sandbox } = await getSandbox(workspace.externalId);
        await sandbox.refreshData();
        switch (sandbox.state as string | undefined) {
          case "started":
            return "running";
          case "paused":
          case "stopped":
          case "archived":
            return "paused";
          case "error":
          case "build_failed":
            return "failed";
          case "destroyed":
          case "destroying":
            return "terminated";
          default:
            return "pending";
        }
      } catch (error) {
        if (error instanceof Error && /not found|404|does not exist/i.test(error.message)) {
          return "terminated";
        }
        throw error;
      }
    },
    async pause(workspace) {
      const { sandbox } = await getSandbox(workspace.externalId);
      await sandbox.refreshData();
      if ((sandbox.state as string | undefined) !== "paused") await sandbox.pause();
    },
    async resume(workspace) {
      const { handle, sandbox } = await getSandbox(workspace.externalId);
      await sandbox.refreshData();
      const previousState = sandbox.state as string | undefined;
      if (previousState !== "started") await sandbox.start();
      // Native pause preserves processes; stopped or archived sandboxes need a fresh server process.
      if (previousState !== "started" && previousState !== "paused") {
        await startAgent(sandbox, handle);
      }
      const runtime = await runtimeFor(sandbox, handle, workspace.runtime.password);
      await waitForDirectRuntime(runtime);
      return runtime;
    },
    async terminate(workspace) {
      const { sandbox } = await getSandbox(workspace.externalId);
      await sandbox.delete();
    },
    async keepAlive(workspace, timeoutMs) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("Daytona keep-alive timeout must be positive");
      }
      const { sandbox } = await getSandbox(workspace.externalId);
      await sandbox.setAutostopInterval(Math.max(1, Math.ceil(timeoutMs / 60_000)));
      await sandbox.refreshActivity();
    },
  };
}
