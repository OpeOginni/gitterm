import { shellQuote, waitForDirectRuntime } from "./provisioning.js";
import type {
  DirectProviderAdapter,
  DirectWorkspaceStatus,
  ExeDevDirectProviderConfig,
} from "./types.js";

const HOME = "/home/exedev";

type ExeDevHandle = {
  vmName: string;
  repoDir: string;
  serve: { command: string; port: number };
};

function serializeHandle(handle: ExeDevHandle): string {
  return JSON.stringify(handle);
}

function parseHandle(value: string): ExeDevHandle {
  try {
    const handle = JSON.parse(value) as ExeDevHandle;
    if (!handle.vmName || !handle.repoDir || !handle.serve?.command || !handle.serve.port) {
      throw new Error("missing required fields");
    }
    return handle;
  } catch {
    throw new Error("Invalid exe.dev direct workspace handle");
  }
}

function findToken(value: unknown): string | undefined {
  if (typeof value === "string") return value.match(/exe[01]\.[A-Za-z0-9._-]+/)?.[0];
  if (Array.isArray(value)) return value.map(findToken).find(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value).map(findToken).find(Boolean);
  }
  return undefined;
}

function resultStatus(value: unknown): DirectWorkspaceStatus {
  const data = value as { status?: string; vms?: Array<{ status?: string }> };
  const status = data?.status ?? data?.vms?.[0]?.status;
  if (status === "running") return "running";
  if (status === "paused") return "paused";
  if (status === "creating") return "pending";
  return "terminated";
}

export function createExeDevDirectProvider(
  config: ExeDevDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiToken.trim()) throw new Error("exe.dev apiToken is required");

  async function execute(command: string): Promise<unknown> {
    const response = await fetch("https://exe.dev/exec", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "text/plain" },
      body: command,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`exe.dev command failed (${response.status}): ${text}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  const runVmCommand = (handle: ExeDevHandle, command: string) =>
    execute(`ssh ${handle.vmName} -- bash -lc ${shellQuote(command)}`);

  async function startRuntime(handle: ExeDevHandle): Promise<void> {
    await runVmCommand(
      handle,
      `cd ${shellQuote(handle.repoDir)} && nohup setsid bash -lc ${shellQuote(handle.serve.command)} > /tmp/opencode-server.log 2>&1 </dev/null &`,
    );
  }

  async function accessToken(vmName: string): Promise<string> {
    const token = findToken(
      await execute(`ssh-key generate-api-key --vm=${vmName} --label=gitterm-direct --exp=never`),
    );
    if (!token) throw new Error("exe.dev did not return a VM access token");
    return token;
  }

  async function waitUntilRunning(vmName: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const status = await execute(`ls ${vmName}`)
        .then(resultStatus)
        .catch(() => "pending" as const);
      if (status === "running") return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Timed out waiting for exe.dev VM");
  }

  async function runtime(handle: ExeDevHandle, password: string) {
    const token = await accessToken(handle.vmName);
    return {
      url: `https://${handle.vmName}.exe.xyz`,
      directory: handle.repoDir,
      password,
      headers: { "X-Exedev-Authorization": `Bearer ${token}` },
    };
  }

  return {
    name: "exedev",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: false,
    },
    async create(input) {
      const plan = input.provisioning;
      const vmSuffix = input.id
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 20)
        .toLowerCase();
      const vmName = `gitterm-${vmSuffix}`;
      const handle: ExeDevHandle = {
        vmName,
        repoDir: `${HOME}/${plan.repository?.name ?? "workspace"}`,
        serve: { command: plan.agent.command, port: plan.agent.port },
      };
      const environment = {
        ...plan.agent.environmentVariables,
        ...(plan.repository?.authToken
          ? {
              GITHUB_APP_TOKEN: plan.repository.authToken,
              GITTERM_GIT_USERNAME: plan.repository.authUsername ?? "x-access-token",
            }
          : {}),
      };
      const createArgs = [
        `new --name=${vmName}`,
        "--no-email",
        `--tag=gitterm-${input.id}`,
        config.image ? `--image=${shellQuote(config.image)}` : "",
        config.cpu ? `--cpu=${config.cpu}` : "",
        config.memory ? `--memory=${shellQuote(config.memory)}` : "",
        config.disk ? `--disk=${shellQuote(config.disk)}` : "",
        ...Object.entries(environment).map(
          ([key, value]) => `--env=${shellQuote(`${key}=${value}`)}`,
        ),
      ]
        .filter(Boolean)
        .join(" ");

      await execute(createArgs);
      try {
        await waitUntilRunning(vmName);
        await runVmCommand(handle, `mkdir -p ${shellQuote(handle.repoDir)}`);
        for (const command of config.runtimeSetupCommands ?? [
          "npm install -g opencode-ai --no-audit --fund=false",
        ]) {
          await runVmCommand(handle, command);
        }
        if (plan.repository) {
          if (plan.repository.authToken) {
            const helper =
              '!f() { [ "$1" = get ] || exit 0; printf "%s\\n" "username=$GITTERM_GIT_USERNAME" "password=$GITHUB_APP_TOKEN"; }; f';
            await runVmCommand(
              handle,
              `git config --global credential.helper ${shellQuote(helper)}`,
            );
          }
          const branch = plan.repository.checkoutRef ?? plan.repository.branch;
          await runVmCommand(
            handle,
            `GIT_TERMINAL_PROMPT=0 git clone ${branch ? `--branch ${shellQuote(branch)}` : ""} ${shellQuote(plan.repository.url)} ${shellQuote(handle.repoDir)}`,
          );
          if (plan.repository.baseCommit) {
            await runVmCommand(
              handle,
              `GIT_TERMINAL_PROMPT=0 git -C ${shellQuote(handle.repoDir)} fetch --depth 1 origin ${shellQuote(plan.repository.baseCommit)} && git -C ${shellQuote(handle.repoDir)} checkout --detach ${shellQuote(plan.repository.baseCommit)}`,
            );
          }
        }
        for (const file of plan.agent.files) {
          const path = file.path.startsWith("~/") ? `${HOME}/${file.path.slice(2)}` : file.path;
          await runVmCommand(
            handle,
            `mkdir -p ${shellQuote(path.slice(0, path.lastIndexOf("/")))} && printf %s ${shellQuote(file.contentBase64)} | base64 -d > ${shellQuote(path)}`,
          );
        }
        for (const command of plan.setupCommands) {
          await runVmCommand(handle, `cd ${shellQuote(handle.repoDir)} && ${command}`);
        }
        await startRuntime(handle);
        await execute(`share port ${vmName} ${handle.serve.port}`);
        await execute(`share set-private ${vmName}`);
        const directRuntime = await runtime(handle, input.password);
        await waitForDirectRuntime(directRuntime);
        return { externalId: serializeHandle(handle), runtime: directRuntime };
      } catch (error) {
        await execute(`rm ${vmName}`).catch(() => undefined);
        throw error;
      }
    },
    async status(workspace) {
      try {
        return resultStatus(await execute(`ls ${parseHandle(workspace.externalId).vmName}`));
      } catch (error) {
        if (error instanceof Error && /not found|404|does not exist/i.test(error.message)) {
          return "terminated";
        }
        throw error;
      }
    },
    async pause(workspace) {
      await execute(`pause ${parseHandle(workspace.externalId).vmName}`);
    },
    async resume(workspace) {
      const handle = parseHandle(workspace.externalId);
      await execute(`resume ${handle.vmName}`);
      await waitUntilRunning(handle.vmName);
      await execute(`share port ${handle.vmName} ${handle.serve.port}`);
      await execute(`share set-private ${handle.vmName}`);
      if (!workspace.runtime.password) throw new Error("exe.dev runtime password is missing");
      const directRuntime = await runtime(handle, workspace.runtime.password);
      await waitForDirectRuntime(directRuntime);
      return directRuntime;
    },
    async terminate(workspace) {
      await execute(`rm ${parseHandle(workspace.externalId).vmName}`);
    },
  };
}
