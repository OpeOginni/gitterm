export type HttpRuntimeHealthPollOptions = {
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  intervalMs?: number;
  fetch?: (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => Promise<Response>;
  isHealthy?: (response: Response) => boolean;
  onUnhealthy?: () => void | Promise<void>;
};

const MAX_FETCH_ATTEMPT_MS = 10_000;

async function fetchWithTimeout(
  fetchImpl: NonNullable<HttpRuntimeHealthPollOptions["fetch"]>,
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      fetchImpl(url, { headers, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Runtime health request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Poll an HTTP endpoint until it returns a healthy response or the deadline expires. */
export async function pollHttpRuntimeHealth({
  url,
  headers,
  timeoutMs,
  intervalMs = 1_000,
  fetch: fetchImpl = globalThis.fetch,
  isHealthy = (response) => response.ok,
  onUnhealthy,
}: HttpRuntimeHealthPollOptions): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  do {
    try {
      const attemptTimeoutMs = Math.max(1, Math.min(MAX_FETCH_ATTEMPT_MS, deadline - Date.now()));
      const response = await fetchWithTimeout(fetchImpl, url, headers, attemptTimeoutMs);
      if (isHealthy(response)) return true;
    } catch {
      // Connection failures are expected while a runtime is starting.
    }

    await onUnhealthy?.();

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
  } while (Date.now() < deadline);

  return false;
}
