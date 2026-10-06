/** Stream platform attachments with a deadline and actual-byte bound; never forward credentials
 * to redirects or to a URL outside the platform's documented file hosts. */
export async function downloadImage(
  url: string,
  options: {
    hosts: string[];
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<string> {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    !options.hosts.includes(target.hostname)
  )
    throw new Error("Untrusted attachment URL");
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const response = await fetch(target, { headers: options.headers, redirect: "error", signal });
  const max = 5_000_000;
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.startsWith("image/") ||
    Number(response.headers.get("content-length")) > max
  ) {
    await response.body?.cancel();
    throw new Error(`Could not download image (HTTP ${response.status})`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error("Attachment exceeds 5 MB");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString("base64");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
