import { Daytona, Image, type Sandbox } from "@daytonaio/sdk";
import {
  classifyFailure,
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  terminated,
  validateLifetime,
  validatePort,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "./types";

const profile = SANDBOX_PROVIDER_PROFILES.daytona;
/** Daytona's default snapshots ship coding agent CLIs; sandboxes use a plain image instead. */
export const DEFAULT_DAYTONA_SANDBOX_IMAGE = "node:22-bookworm-slim";
const failure = (error: unknown, action: string) => classifyFailure("Daytona", error, action);

function infoFrom(sandbox: Sandbox): SandboxProviderInfo {
  const state = String(sandbox.state ?? "");
  return {
    id: sandbox.id,
    state: ["started"].includes(state)
      ? "running"
      : ["stopped", "paused", "archived", "stopping", "pausing", "archiving"].includes(state)
        ? "paused"
        : ["destroyed", "destroying", "error", "build_failed"].includes(state)
          ? "terminated"
          : "pending",
    labels: sandbox.labels ?? {},
    startedAt: sandbox.createdAt ?? null,
    expiresAt: sandbox.labels?.gitterm_expires_at ?? null,
  };
}

/**
 * Daytona's default sandbox image (no coding agent). `ttlMinutes` is a hard wall-clock
 * lifetime the provider enforces even while the sandbox is busy, stopped, or archived.
 */
export function createDaytonaSandboxTransport(config: {
  apiKey: string;
  target?: "us" | "eu";
  snapshot?: string;
}): SandboxTransport {
  if (!config.apiKey?.trim()) throw new SandboxProviderError("auth", "Daytona apiKey is empty.");
  const client = new Daytona({
    apiKey: config.apiKey,
    ...(config.target ? { target: config.target } : {}),
  });

  const get = async (id: string) => {
    try {
      return await client.get(id);
    } catch (error) {
      throw failure(error, "read the sandbox");
    }
  };
  const running = async (id: string) => {
    const sandbox = await get(id);
    if (infoFrom(sandbox).state !== "running")
      throw new SandboxProviderError("not_found", `The Daytona sandbox is ${sandbox.state}.`);
    return sandbox;
  };

  return {
    provider: "daytona",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const minutes = Math.ceil(input.timeoutMs / 60_000);
      const kill = (input.onTimeout ?? "kill") === "kill";
      let sandbox: Sandbox;
      try {
        sandbox = await client.create(
          {
            ...(config.snapshot
              ? { snapshot: config.snapshot }
              : {
                  image: Image.base(input.template ?? DEFAULT_DAYTONA_SANDBOX_IMAGE).entrypoint([
                    "sleep",
                    "infinity",
                  ]),
                }),
            labels: {
              ...input.labels,
              ...(kill
                ? { gitterm_expires_at: new Date(Date.now() + minutes * 60_000).toISOString() }
                : {}),
            },
            public: input.publicPreviews === true,
            // Direct: deleted at the lifetime. Managed: stopped when idle, Gitterm terminates later.
            ...(kill
              ? { ttlMinutes: minutes, autoStopInterval: minutes, autoDeleteInterval: 0 }
              : { autoStopInterval: minutes, autoDeleteInterval: -1 }),
          },
          // A plain image is built into a snapshot on first use.
          { timeout: 600 },
        );
      } catch (error) {
        throw failure(error, "create a sandbox");
      }
      try {
        const check = await sandbox.process.executeCommand("true", undefined, undefined, 30);
        if (check.exitCode !== 0) throw new Error("sandbox did not run a command");
        return infoFrom(sandbox);
      } catch (error) {
        await sandbox.delete().catch(() => {});
        throw failure(error, "prepare the sandbox");
      }
    },

    async info(id) {
      try {
        const sandbox = await client.get(id);
        return infoFrom(sandbox);
      } catch (error) {
        const classified = failure(error, "read the sandbox");
        if (classified.code === "not_found") return terminated(id);
        throw classified;
      }
    },

    async list(labels) {
      try {
        const items: SandboxProviderInfo[] = [];
        for await (const sandbox of client.list({ labels })) {
          items.push(infoFrom(sandbox));
          if (items.length >= 500) break;
        }
        return items.filter((item) => item.state !== "terminated");
      } catch (error) {
        throw failure(error, "list sandboxes");
      }
    },

    async destroy(id) {
      try {
        // Wait for Daytona to finish; by default delete() returns once it is accepted.
        await (await client.get(id)).delete(180, true);
      } catch (error) {
        const classified = failure(error, "delete the sandbox");
        if (classified.code !== "not_found") throw classified;
      }
    },

    async pause(id) {
      try {
        await (await get(id)).stop();
      } catch (error) {
        throw failure(error, "stop the sandbox");
      }
    },

    async resume(id) {
      try {
        await (await get(id)).start();
      } catch (error) {
        throw failure(error, "start the sandbox");
      }
    },

    async keepAlive(id) {
      try {
        await (await get(id)).refreshActivity();
      } catch (error) {
        throw failure(error, "record sandbox activity");
      }
    },

    async run(id, command, options = {}) {
      const sandbox = await running(id);
      try {
        const result = await sandbox.process.executeCommand(
          command,
          options.cwd,
          options.env,
          Math.ceil((options.timeoutMs ?? 60_000) / 1000),
        );
        // Daytona returns stdout and stderr combined.
        return { exitCode: result.exitCode, stdout: result.result, stderr: "" };
      } catch (error) {
        throw failure(error, "run a command");
      }
    },

    async writeFile(id, path, data) {
      const sandbox = await running(id);
      try {
        await sandbox.fs.uploadFile(Buffer.from(data), path);
      } catch (error) {
        throw failure(error, "upload a file");
      }
    },

    async readFile(id, path) {
      const sandbox = await running(id);
      try {
        return new Uint8Array(await sandbox.fs.downloadFile(path));
      } catch (error) {
        throw failure(error, "download a file");
      }
    },

    async preview(id, port) {
      validatePort(port);
      const sandbox = await running(id);
      try {
        const link = await sandbox.getPreviewLink(port);
        const headers: Record<string, string> = link.token
          ? { "x-daytona-preview-token": link.token, "X-Daytona-Skip-Preview-Warning": "true" }
          : {};
        return { url: link.url, headers };
      } catch (error) {
        throw failure(error, "get a preview link");
      }
    },
  };
}
