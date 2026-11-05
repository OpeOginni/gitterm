import {
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  validateLifetime,
  type SandboxFailureCode,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "./types";

const at = (id: string) => `/v1/sandboxes/${encodeURIComponent(id)}`;
const json = async <T>(response: Response) => (await response.json()) as T;
const info = (sandbox: {
  id: string;
  state: SandboxProviderInfo["state"];
  labels: Record<string, string>;
  startedAt: string | null;
  expiresAt: string | null;
}): SandboxProviderInfo => ({
  id: sandbox.id,
  state: sandbox.state,
  labels: sandbox.labels,
  startedAt: sandbox.startedAt,
  expiresAt: sandbox.expiresAt,
});

/**
 * Gitterm's own sandboxes, on gitterm.dev only (self-hosted deployments never configure them).
 * Callers ask for a size: `small`, `medium`, or `large`, from the machine profile's `size`
 * option. A thin client for the service's API, authenticated with the token the Gitterm
 * server holds.
 */
export function createGittermComputeTransport(config: {
  url: string;
  serviceToken: string;
}): SandboxTransport {
  const base = config.url.replace(/\/$/, "");
  const profile = SANDBOX_PROVIDER_PROFILES.gitterm;

  async function call(
    method: string,
    path: string,
    action: string,
    body?: unknown,
    raw?: Uint8Array,
    timeoutMs = 150_000,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${config.serviceToken}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(raw ? { "content-type": "application/octet-stream" } : {}),
        },
        body: raw
          ? (raw as Uint8Array<ArrayBuffer>)
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new SandboxProviderError(
        timedOut ? "timeout" : "provider",
        `Gitterm ${timedOut ? "timed out" : "could not be reached"} while trying to ${action}.`,
      );
    }
    if (response.ok) return response;
    const error = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    // The service rejecting our token is this deployment's configuration problem.
    const code: SandboxFailureCode =
      response.status === 401
        ? "auth"
        : ((["auth", "not_found", "rate_limited", "timeout"] as const).find(
            (known) => known === error.error?.code,
          ) ?? "provider");
    throw new SandboxProviderError(
      code,
      error.error?.message ?? `Gitterm failed to ${action} (${response.status}).`,
    );
  }

  return {
    provider: "gitterm",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const size = input.machine?.size;
      if (typeof size !== "string")
        throw new Error("Gitterm sandboxes need a machine profile with a size");
      return info(
        await json(
          await call(
            "POST",
            "/v1/sandboxes",
            "create a sandbox",
            {
              size,
              // An image name, e.g. an agent workspace image; omitted for a plain sandbox.
              image: input.template,
              env: input.env,
              resumeCommand: input.resumeCommand,
              timeoutMs: input.timeoutMs,
              onTimeout: input.onTimeout ?? "kill",
              publicPreviews: input.publicPreviews === true,
              labels: input.labels,
            },
            undefined,
            // Installing an image can take minutes.
            20 * 60_000,
          ),
        ),
      );
    },
    async info(id) {
      try {
        return info(await json(await call("GET", at(id), "read the sandbox")));
      } catch (error) {
        if (error instanceof SandboxProviderError && error.code === "not_found")
          return { id, state: "terminated", labels: {}, startedAt: null, expiresAt: null };
        throw error;
      }
    },
    async list(labels) {
      const query = encodeURIComponent(JSON.stringify(labels));
      const sandboxes = await json<Parameters<typeof info>[0][]>(
        await call("GET", `/v1/sandboxes?labels=${query}`, "list sandboxes"),
      );
      return sandboxes.map(info);
    },
    async destroy(id) {
      await call("DELETE", at(id), "delete the sandbox");
    },
    async pause(id) {
      await call("POST", `${at(id)}/pause`, "pause the sandbox", {});
    },
    async resume(id) {
      await call("POST", `${at(id)}/resume`, "resume the sandbox", {});
    },
    async keepAlive(id, timeoutMs) {
      await call("POST", `${at(id)}/keep-alive`, "extend the sandbox", { timeoutMs });
    },
    async run(id, command, options = {}) {
      return json(
        await call(
          "POST",
          `${at(id)}/exec`,
          "run a command",
          { command, ...options },
          undefined,
          (options.timeoutMs ?? 60_000) + 30_000,
        ),
      );
    },
    async writeFile(id, path, data) {
      await call(
        "PUT",
        `${at(id)}/files?path=${encodeURIComponent(path)}`,
        "write a file",
        undefined,
        data,
      );
    },
    async readFile(id, path) {
      const response = await call(
        "GET",
        `${at(id)}/files?path=${encodeURIComponent(path)}`,
        "read a file",
      );
      return new Uint8Array(await response.arrayBuffer());
    },
    async preview(id, port) {
      return json(await call("GET", `${at(id)}/previews/${port}`, "open a preview"));
    },
  };
}
