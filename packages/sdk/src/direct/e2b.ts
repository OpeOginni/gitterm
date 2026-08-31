import { Sandbox } from "e2b";
import {
  DIRECT_E2B_TEMPLATES,
  setupCommandScript,
  shellQuote,
  waitForDirectRuntime,
} from "./provisioning.js";
import type { DirectProviderAdapter, E2BDirectProviderConfig } from "./types.js";

const WORKSPACE_ROOT = "/home/user/workspace";

export function createE2BDirectProvider(config: E2BDirectProviderConfig): DirectProviderAdapter {
  if (!config.apiKey.trim()) throw new Error("E2B apiKey is required");
  const size = config.size ?? "standard";
  if (size !== "standard" && size !== "large") {
    throw new Error("E2B size must be standard or large");
  }
  const templateId = config.templateId?.trim() || DIRECT_E2B_TEMPLATES[size];

  const connect = (externalId: string) => Sandbox.connect(externalId, { apiKey: config.apiKey });

  return {
    name: "e2b",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "ephemeral",
      supportsPause: true,
      ephemeralPause: "stateful",
      supportsKeepAlive: true,
    },
    async create(input) {
      const plan = input.provisioning;
      const sandbox = await Sandbox.create(templateId, {
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs ?? 10 * 60_000,
        lifecycle: { onTimeout: input.lifecycle === "persistent" ? "pause" : "kill" },
        network: { allowPublicTraffic: false },
        envs: plan.agent.environmentVariables,
      });
      const directory = `${WORKSPACE_ROOT}/${plan.repository?.name ?? "workspace"}`;

      try {
        await sandbox.commands.run(`mkdir -p ${shellQuote(WORKSPACE_ROOT)}`);
        if (plan.repository) {
          await sandbox.git.clone(plan.repository.url, {
            path: directory,
            branch: plan.repository.checkoutRef ?? plan.repository.branch,
            username: plan.repository.authToken
              ? (plan.repository.authUsername ?? "x-access-token")
              : undefined,
            password: plan.repository.authToken,
          });
        } else {
          await sandbox.commands.run(`mkdir -p ${shellQuote(directory)}`);
        }
        if (plan.repository?.baseCommit) {
          await sandbox.commands.run(
            `git -C ${shellQuote(directory)} fetch --depth 1 origin ${shellQuote(plan.repository.baseCommit)} && git -C ${shellQuote(directory)} checkout --detach ${shellQuote(plan.repository.baseCommit)}`,
          );
        }
        for (const file of plan.agent.files) {
          const path = file.path.replace(/^~/, "/home/user");
          const parent = path.slice(0, path.lastIndexOf("/"));
          await sandbox.commands.run(
            `mkdir -p ${shellQuote(parent)} && printf %s ${shellQuote(file.contentBase64)} | base64 -d > ${shellQuote(path)}`,
          );
        }
        if (plan.setupCommands.length) {
          await sandbox.commands.run(setupCommandScript(plan.setupCommands), { cwd: directory });
        }
        await sandbox.commands.run(plan.agent.command, {
          cwd: directory,
          background: true,
          envs: plan.agent.environmentVariables,
        });
        const token = sandbox.trafficAccessToken;
        if (!token) throw new Error("E2B traffic access token is missing");
        const runtime = {
          url: `https://${sandbox.getHost(plan.agent.port)}`,
          directory,
          password: input.password,
          headers: { "e2b-traffic-access-token": token },
        };
        await waitForDirectRuntime(runtime);
        return { externalId: sandbox.sandboxId, runtime };
      } catch (error) {
        await sandbox.kill().catch(() => undefined);
        throw error;
      }
    },
    async status(workspace) {
      try {
        const info = (await Sandbox.getInfo(workspace.externalId, { apiKey: config.apiKey })) as {
          state?: string;
        };
        return info.state === "paused"
          ? "paused"
          : info.state === "running"
            ? "running"
            : "terminated";
      } catch (error) {
        if (error instanceof Error && /not found|404|does not exist/i.test(error.message)) {
          return "terminated";
        }
        throw error;
      }
    },
    async pause(workspace) {
      await (await connect(workspace.externalId)).pause({ apiKey: config.apiKey });
    },
    async resume(workspace) {
      const sandbox = await connect(workspace.externalId);
      const token = sandbox.trafficAccessToken;
      if (!token) throw new Error("E2B traffic access token is missing");
      const runtime = {
        ...workspace.runtime,
        url: `https://${sandbox.getHost(4096)}`,
        headers: { "e2b-traffic-access-token": token },
      };
      await waitForDirectRuntime(runtime);
      return runtime;
    },
    async terminate(workspace) {
      await Sandbox.kill(workspace.externalId, { apiKey: config.apiKey });
    },
    async keepAlive(workspace, timeoutMs) {
      await Sandbox.setTimeout(workspace.externalId, timeoutMs, { apiKey: config.apiKey });
    },
  };
}
