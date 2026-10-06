import { afterEach, expect, test } from "bun:test";
import { downloadImage } from "./download.js";
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const options = { hosts: ["files.slack.com"], headers: { Authorization: "secret" } };
test("credential-bearing downloads reject untrusted and redirect destinations before sending", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response();
  }) as unknown as typeof fetch;
  for (const url of [
    "https://evil.test/file",
    "http://files.slack.com/file",
    "https://files.slack.com.evil.test/file",
    "https://user:pass@files.slack.com/file",
    "https://files.slack.com:8443/file",
  ]) {
    await expect(downloadImage(url, options)).rejects.toThrow("Untrusted attachment");
  }
  expect(calls).toBe(0);
});
test("actual streamed bytes are bounded even when content-length lies", async () => {
  globalThis.fetch = (async (_url, init) => {
    expect(init?.redirect).toBe("error");
    return new Response(new Uint8Array(5_000_001), {
      headers: { "content-type": "image/png", "content-length": "1" },
    });
  }) as typeof fetch;
  await expect(downloadImage("https://files.slack.com/file", options)).rejects.toThrow(
    "exceeds 5 MB",
  );
});
test("successful downloads return base64 and reject non-images", async () => {
  globalThis.fetch = (async () =>
    new Response("image", { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
  expect(await downloadImage("https://files.slack.com/file", options)).toBe(
    Buffer.from("image").toString("base64"),
  );
  globalThis.fetch = (async () =>
    new Response("login", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  await expect(downloadImage("https://files.slack.com/file", options)).rejects.toThrow(
    "Could not download image",
  );
});
