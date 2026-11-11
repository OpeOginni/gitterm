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

export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`File is larger than ${maxBytes} bytes`);
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

/**
 * Sent by a caller that only observes a workspace: a status poll, a health check, reading a
 * run. GitTerm's proxy routes the request as usual but does not count it as use of the
 * workspace, so watching a workspace does not keep it from pausing when it is idle. Requests
 * that do work (a prompt, a reply, a shell command) never carry it.
 *
 * The name avoids the `X-GitTerm-` prefix, which the proxy strips from client requests.
 */
export const PASSIVE_REQUEST_HEADER = "X-Passive-Request";

/** Request options for a call that only observes; see PASSIVE_REQUEST_HEADER. */
export function observing(signal?: AbortSignal, timeoutMs?: number) {
  return { ...requestTimeout(signal, timeoutMs), headers: { [PASSIVE_REQUEST_HEADER]: "1" } };
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
