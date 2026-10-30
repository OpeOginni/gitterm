import {
  AuthenticationError,
  CommandExitError,
  NotFoundError,
  RateLimitError,
  Sandbox,
  TimeoutError,
} from "e2b";
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

export const DEFAULT_E2B_TEMPLATE = "base";
/** E2B Hobby accounts cap a sandbox at one hour; Pro at 24 hours. */
const profile = SANDBOX_PROVIDER_PROFILES.e2b;
const MAX_LIFETIME_MS = profile.capabilities.maxLifetimeMs;
const EXPIRES_LABEL = "gitterm_expires_at";

const failure = (error: unknown, action: string) => {
  if (error instanceof RateLimitError)
    return new SandboxProviderError("rate_limited", `E2B rate-limited the request to ${action}.`);
  if (error instanceof TimeoutError)
    return new SandboxProviderError("timeout", `E2B timed out while trying to ${action}.`);
  return classifyFailure("E2B", error, action, {
    auth: (e) => e instanceof AuthenticationError,
    notFound: (e) => e instanceof NotFoundError,
  });
};

function infoFrom(info: {
  sandboxId: string;
  state: string;
  metadata?: Record<string, string>;
  startedAt: Date;
  endAt: Date;
}): SandboxProviderInfo {
  return {
    id: info.sandboxId,
    state: info.state === "paused" ? "paused" : "running",
    labels: info.metadata ?? {},
    startedAt: info.startedAt.toISOString(),
    expiresAt: info.metadata?.[EXPIRES_LABEL] ?? info.endAt.toISOString(),
  };
}

/** E2B `base` template: no coding agent. The provider kills (or pauses) at the timeout. */
export function createE2BSandboxTransport(config: {
  apiKey: string;
  template?: string;
}): SandboxTransport {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) throw new SandboxProviderError("auth", "E2B apiKey is empty.");
  const opts = { apiKey };

  async function info(id: string): Promise<SandboxProviderInfo> {
    try {
      return infoFrom(await Sandbox.getInfo(id, opts));
    } catch (error) {
      const classified = failure(error, "read the sandbox");
      if (classified.code === "not_found") return terminated(id);
      throw classified;
    }
  }

  /**
   * Connecting extends a running sandbox's timeout when the requested value is longer,
   * so pass the remaining lifetime: a reconnect must never outlive the approved deadline.
   */
  async function connect(id: string): Promise<Sandbox> {
    const current = await info(id);
    if (current.state === "terminated")
      throw new SandboxProviderError("not_found", "The sandbox no longer exists.");
    const remaining = Date.parse(current.expiresAt ?? "") - Date.now();
    if (!(remaining > 1_000))
      throw new SandboxProviderError("not_found", "The sandbox has reached its lifetime limit.");
    try {
      return await Sandbox.connect(id, { ...opts, timeoutMs: remaining });
    } catch (error) {
      throw failure(error, "connect to the sandbox");
    }
  }

  return {
    provider: "e2b",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, MAX_LIFETIME_MS);
      const onTimeout = input.onTimeout ?? "kill";
      const labels = {
        ...input.labels,
        // A paused sandbox has no fixed deadline; only killed ones carry one.
        ...(onTimeout === "kill"
          ? { [EXPIRES_LABEL]: new Date(Date.now() + input.timeoutMs).toISOString() }
          : {}),
      };
      let sandbox: Sandbox;
      try {
        sandbox = await Sandbox.create(input.template ?? config.template ?? DEFAULT_E2B_TEMPLATE, {
          ...opts,
          timeoutMs: input.timeoutMs,
          metadata: labels,
          lifecycle: { onTimeout },
          network: { allowPublicTraffic: input.publicPreviews === true },
        });
      } catch (error) {
        throw failure(error, "create a sandbox");
      }
      try {
        await sandbox.commands.run("true", { timeoutMs: 30_000 });
        return infoFrom(await Sandbox.getInfo(sandbox.sandboxId, opts));
      } catch (error) {
        // Never leave a billable sandbox behind when setup after creation fails.
        await Sandbox.kill(sandbox.sandboxId, opts).catch(() => {});
        throw failure(error, "prepare the sandbox");
      }
    },

    info,

    async list(labels) {
      try {
        const paginator = Sandbox.list({
          ...opts,
          query: {
            // E2B rejects an empty metadata filter.
            ...(Object.keys(labels).length ? { metadata: labels } : {}),
            state: ["running", "paused"],
          },
        });
        const items: SandboxProviderInfo[] = [];
        while (paginator.hasNext && items.length < 500) {
          for (const item of await paginator.nextItems()) items.push(infoFrom(item));
        }
        return items;
      } catch (error) {
        throw failure(error, "list sandboxes");
      }
    },

    async destroy(id) {
      try {
        await Sandbox.kill(id, opts);
      } catch (error) {
        const classified = failure(error, "delete the sandbox");
        if (classified.code !== "not_found") throw classified;
      }
    },

    async pause(id) {
      try {
        await Sandbox.pause(id, opts);
      } catch (error) {
        throw failure(error, "pause the sandbox");
      }
    },

    async resume(id) {
      try {
        await Sandbox.connect(id, opts);
      } catch (error) {
        throw failure(error, "resume the sandbox");
      }
    },

    async keepAlive(id, timeoutMs) {
      try {
        await Sandbox.setTimeout(id, timeoutMs, opts);
      } catch (error) {
        throw failure(error, "extend the sandbox timeout");
      }
    },

    async run(id, command, options = {}) {
      const sandbox = await connect(id);
      try {
        const result = await sandbox.commands.run(command, {
          cwd: options.cwd,
          envs: options.env,
          timeoutMs: options.timeoutMs ?? 60_000,
        });
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        if (error instanceof CommandExitError)
          return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
        throw failure(error, "run a command");
      }
    },

    async writeFile(id, path, data) {
      const sandbox = await connect(id);
      try {
        await sandbox.files.write(path, new Blob([data as Uint8Array<ArrayBuffer>]));
      } catch (error) {
        throw failure(error, "upload a file");
      }
    },

    async readFile(id, path) {
      const sandbox = await connect(id);
      try {
        return await sandbox.files.read(path, { format: "bytes" });
      } catch (error) {
        throw failure(error, "download a file");
      }
    },

    async preview(id, port) {
      validatePort(port);
      const sandbox = await connect(id);
      const token = sandbox.trafficAccessToken;
      const headers: Record<string, string> = token ? { "e2b-traffic-access-token": token } : {};
      return { url: `https://${sandbox.getHost(port)}`, headers };
    },
  };
}
