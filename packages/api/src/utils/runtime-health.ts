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
};

/** Poll an HTTP endpoint until it returns a healthy response or the deadline expires. */
export async function pollHttpRuntimeHealth({
  url,
  headers,
  timeoutMs,
  intervalMs = 1_000,
  fetch: fetchImpl = globalThis.fetch,
  isHealthy = (response) => response.ok,
}: HttpRuntimeHealthPollOptions): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  do {
    try {
      const response = await fetchImpl(url, { headers });
      if (isHealthy(response)) return true;
    } catch {
      // Connection failures are expected while a runtime is starting.
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
  } while (Date.now() < deadline);

  return false;
}
