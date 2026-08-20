import { describe, expect, test } from "bun:test";
import { createNoRedirectFetch, normalizeServerUrl } from "./transport";

describe("SDK transport security", () => {
  test("requires HTTPS except for explicit loopback servers", () => {
    expect(normalizeServerUrl("https://api.gitterm.dev/")).toBe("https://api.gitterm.dev");
    expect(normalizeServerUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeServerUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(() => normalizeServerUrl("http://api.example.com")).toThrow(/HTTPS/);
    expect(() => normalizeServerUrl("https://token@api.example.com")).toThrow(/credentials/);
  });

  test("does not follow redirects", async () => {
    let redirectMode: RequestRedirect | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      redirectMode = init?.redirect;
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/collect" },
      });
    }) as typeof fetch;

    await expect(createNoRedirectFetch(fetchImpl)("https://api.example.com/trpc")).rejects.toThrow(
      /redirects are not allowed/,
    );
    expect(redirectMode).toBe("manual");
  });
});
