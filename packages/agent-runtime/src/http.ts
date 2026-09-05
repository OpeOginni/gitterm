import type { RuntimeSignal, RuntimeTarget } from "./types";

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

export function runtimeUrl(
  target: Pick<RuntimeTarget, "url"> & Partial<Pick<RuntimeTarget, "api" | "directory">>,
  path: string,
): string {
  const url = new URL(`${target.url.replace(/\/$/, "")}${path}`);
  if (target.api === "v2" && target.directory && !url.searchParams.has("location")) {
    url.searchParams.set("location", JSON.stringify({ directory: target.directory }));
  }
  return url.toString();
}

export function createRuntimeHttp(target: RuntimeTarget) {
  const headers = { ...target.headers, ...authorizationHeader(target.password) };
  async function send(path: string, init: RequestInit & { json?: unknown } = {}) {
    const { json, ...rest } = init;
    const response = await (target.fetch ?? fetch)(runtimeUrl(target, path), {
      ...rest,
      headers: {
        accept: "application/json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
        ...(rest.headers as Record<string, string> | undefined),
      },
      body: json === undefined ? rest.body : JSON.stringify(json),
      signal:
        rest.signal ??
        (target.signal
          ? AbortSignal.any([target.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000)),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let tag: string | null = null;
      try {
        const parsed = JSON.parse(body) as { _tag?: unknown; name?: unknown };
        tag =
          typeof parsed._tag === "string"
            ? parsed._tag
            : typeof parsed.name === "string"
              ? parsed.name
              : null;
      } catch {}
      throw new RuntimeHttpError(response.status, body, tag);
    }
    return response;
  }

  return {
    send,
    async json<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
      const response = await send(path, init);
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
  };
}

type ServerSentEvent = { event: string | null; data: string };

/** Yields a synthetic `open` event first; ends on server close, throws on failure or abort. */
export async function* readServerSentEvents(
  url: string,
  init: { headers?: Record<string, string>; signal: AbortSignal; fetch?: typeof fetch },
): AsyncGenerator<ServerSentEvent, void, undefined> {
  const response = await (init.fetch ?? fetch)(url, {
    headers: { accept: "text/event-stream", ...init.headers },
    signal: init.signal,
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new RuntimeHttpError(response.status, "", null);
  }
  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  init.signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let event: string | null = null;
  try {
    init.signal.throwIfAborted();
    yield { event: "open", data: "" };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length > 0) yield { event, data: data.join("\n") };
          data = [];
          event = null;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let fieldValue = colon === -1 ? "" : line.slice(colon + 1);
        if (fieldValue.startsWith(" ")) fieldValue = fieldValue.slice(1);
        if (field === "data") data.push(fieldValue);
        else if (field === "event") event = fieldValue;
      }
    }
    init.signal.throwIfAborted();
  } finally {
    init.signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
  }
}

export async function* signalStream(
  target: RuntimeTarget,
  path: string,
  parse: (raw: Record<string, unknown>) => RuntimeSignal | null,
  signal: AbortSignal,
): AsyncGenerator<RuntimeSignal, void, undefined> {
  const stream = readServerSentEvents(runtimeUrl(target, path), {
    headers: { ...target.headers, ...authorizationHeader(target.password) },
    signal,
    fetch: target.fetch,
  });
  for await (const item of stream) {
    if (item.event === "open") {
      yield { type: "connected" };
      continue;
    }
    const raw = parseEventData(item.data);
    const parsed = raw && parse(raw);
    if (parsed) yield parsed;
  }
}

export function parseEventData(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
