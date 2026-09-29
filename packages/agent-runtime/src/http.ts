import { ClientError, OpenCode, type OpenCodeClient } from "@opencode/client";
import type { RuntimeTarget } from "./types";

export class RuntimeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly tag: string | null,
  ) {
    super(`OpenCode request failed with status ${status}${tag ? ` (${tag})` : ""}`);
  }
}

export function isSessionNotFound(error: unknown): boolean {
  return error instanceof RuntimeHttpError && error.status === 404;
}

export function authorizationHeader(password: string | null): Record<string, string> {
  return password
    ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
    : {};
}

export type RuntimeConnection = Pick<RuntimeTarget, "url" | "password"> &
  Partial<Pick<RuntimeTarget, "headers" | "fetch">>;

/** OpenCode 2 client whose non-2xx responses reject with {@link RuntimeHttpError} via {@link call}. */
export function createOpencodeClient(target: RuntimeConnection): OpenCodeClient {
  const send = target.fetch ?? fetch;
  return OpenCode.make({
    baseUrl: target.url,
    headers: { ...target.headers, ...authorizationHeader(target.password) },
    fetch: (async (input, init) => {
      const response = await send(input, init);
      if (response.ok) return response;
      const body = await response.text().catch(() => "");
      throw new RuntimeHttpError(response.status, body, errorTag(body));
    }) as typeof fetch,
  });
}

/** The client wraps every fetch failure as a transport error; surface the original HTTP, abort, or network error. */
export function unwrapClientError(error: unknown): unknown {
  return error instanceof ClientError && error.reason === "Transport" && error.cause !== undefined
    ? error.cause
    : error;
}

export async function call<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw unwrapClientError(error);
  }
}

export function requestTimeout(signal?: AbortSignal, timeoutMs = 15_000): { signal: AbortSignal } {
  return {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  };
}

function errorTag(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { _tag?: unknown; name?: unknown };
    if (typeof parsed._tag === "string") return parsed._tag;
    if (typeof parsed.name === "string") return parsed.name;
  } catch {}
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
