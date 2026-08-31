import { BoxApi, Configuration, waitUntilReady } from "@asciidev/box-sdk";
import {
  cloneRepositoryScript,
  setupCommandScript,
  shellQuote,
  waitForDirectRuntime,
} from "./provisioning.js";
import type { AsciiDirectProviderConfig, DirectProviderAdapter } from "./types.js";

const HOME = "/home/user";

type AsciiHandle = {
  boxId: string;
  repoDir: string;
  serve: { command: string; port: number };
};

function serializeHandle(handle: AsciiHandle): string {
  return JSON.stringify(handle);
}

function parseHandle(value: string): AsciiHandle {
  try {
    const handle = JSON.parse(value) as AsciiHandle;
    if (!handle.boxId || !handle.repoDir || !handle.serve?.command || !handle.serve.port) {
      throw new Error("missing required fields");
    }
    return handle;
  } catch {
    throw new Error("Invalid Ascii Box direct workspace handle");
  }
}

export function createAsciiDirectProvider(
  config: AsciiDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("Ascii apiKey is required");

  const client = new BoxApi(
    new Configuration({
      basePath: "https://ascii.dev/api/box/v1",
      accessToken: config.apiKey,
    }),
  );

  async function runCommand(
    boxId: string,
    command: string,
    cwd?: string,
    timeoutSeconds = 60,
  ): Promise<string> {
    const result = await client.command({
      boxId,
      commandRequest: { command, cwd, timeoutSeconds },
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(`Ascii Box command failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  async function startRuntime(handle: AsciiHandle): Promise<void> {
    await runCommand(
      handle.boxId,
      `nohup setsid bash -lc ${shellQuote(handle.serve.command)} > /tmp/opencode-server.log 2>&1 </dev/null &`,
      handle.repoDir,
    );
  }

  async function getPublicUrl(handle: AsciiHandle): Promise<string> {
    await runCommand(handle.boxId, `host ${handle.serve.port}`);
    const output = await runCommand(handle.boxId, `host url ${handle.serve.port}`);
    const value = output.match(/https:\/\/\S+/)?.[0];
    if (!value) {
      throw new Error(`Ascii Box did not return a hosted URL for port ${handle.serve.port}`);
    }
    const hosted = new URL(value);
    hosted.search = "";
    return hosted.toString();
  }

  async function deleteBox(boxId: string): Promise<void> {
    const response = await fetch(`https://ascii.dev/api/box/v1/boxes/${boxId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Ascii Box deletion failed (${response.status})`);
    }
  }

  return {
    name: "ascii",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    async create(input) {
      const plan = input.provisioning;
      const directory = `${HOME}/${plan.repository?.name ?? "workspace"}`;
      const created = await client.create({
        createBoxRequest: {
          type: config.size,
          ttlSeconds:
            config.timeoutMs === null ? null : Math.ceil((config.timeoutMs ?? 10 * 60_000) / 1000),
          noEnv: true,
          env: plan.agent.environmentVariables,
        },
      });
      const handle: AsciiHandle = {
        boxId: created.box.id,
        repoDir: directory,
        serve: { command: plan.agent.command, port: plan.agent.port },
      };

      try {
        await waitUntilReady(client, handle.boxId);
        await client.update({
          boxId: handle.boxId,
          updateBoxRequest: { name: `gitterm-${input.id}` },
        });
        await runCommand(handle.boxId, `mkdir -p ${shellQuote(directory)}`);
        for (const command of config.runtimeSetupCommands ?? [
          "npm install -g opencode-ai --no-audit --fund=false",
        ]) {
          await runCommand(handle.boxId, command, undefined, 600);
        }
        if (plan.repository) {
          await runCommand(
            handle.boxId,
            cloneRepositoryScript(plan.repository, directory),
            "/",
            600,
          );
        }
        for (const file of plan.agent.files) {
          const path = file.path.startsWith("~/") ? file.path.slice(2) : file.path;
          await client.writeFile({
            boxId: handle.boxId,
            fileWriteRequest: { path, content: file.contentBase64, encoding: "base64" },
          });
        }
        if (plan.setupCommands.length) {
          await runCommand(handle.boxId, setupCommandScript(plan.setupCommands), directory, 600);
        }
        await startRuntime(handle);
        const runtime = {
          url: await getPublicUrl(handle),
          directory,
          password: input.password,
        };
        await waitForDirectRuntime(runtime);
        return { externalId: serializeHandle(handle), runtime };
      } catch (error) {
        await deleteBox(handle.boxId).catch(() => undefined);
        throw error;
      }
    },
    async status(workspace) {
      try {
        const box = (await client.get({ boxId: parseHandle(workspace.externalId).boxId })).box;
        if (["ready", "idle", "running"].includes(box.state)) return "running";
        if (["init", "provisioning", "provisioned", "cloning", "archiving"].includes(box.state)) {
          return "pending";
        }
        if (box.state === "archived") return "paused";
        return "terminated";
      } catch (error) {
        if (error instanceof Error && /not found|404|does not exist/i.test(error.message)) {
          return "terminated";
        }
        throw error;
      }
    },
    async pause(workspace) {
      await client.stop({ boxId: parseHandle(workspace.externalId).boxId });
    },
    async resume(workspace) {
      const handle = parseHandle(workspace.externalId);
      await client.resume({ boxId: handle.boxId, resumeRequest: { noEnv: true } });
      await waitUntilReady(client, handle.boxId);
      await startRuntime(handle);
      const runtime = {
        ...workspace.runtime,
        url: await getPublicUrl(handle),
        headers: undefined,
      };
      await waitForDirectRuntime(runtime);
      return runtime;
    },
    async terminate(workspace) {
      await deleteBox(parseHandle(workspace.externalId).boxId);
    },
    async keepAlive(workspace, timeoutMs) {
      await client.update({
        boxId: parseHandle(workspace.externalId).boxId,
        updateBoxRequest: { ttlSeconds: Math.ceil(timeoutMs / 1000) },
      });
    },
  };
}
