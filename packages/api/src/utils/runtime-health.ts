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
const FIRST_POLL_DELAY_MS = 250;

/**
 * Waits between polls: short at first, doubling up to `maxMs`. A workspace that is nearly
 * ready is noticed within a fraction of a second, and a slow one is not polled any harder
 * than before.
 */
export function pollDelays(maxMs: number): () => number {
  let next = Math.min(FIRST_POLL_DELAY_MS, maxMs);
  return () => {
    const wait = next;
    next = Math.min(next * 2, maxMs);
    return wait;
  };
}

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
  const nextDelay = pollDelays(intervalMs);

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
    await new Promise((resolve) => setTimeout(resolve, Math.min(nextDelay(), remainingMs)));
  } while (Date.now() < deadline);

  return false;
}
