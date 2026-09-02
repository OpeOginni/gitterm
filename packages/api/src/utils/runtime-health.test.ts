import { describe, expect, test } from "bun:test";
import { pollHttpRuntimeHealth } from "./runtime-health";

describe("pollHttpRuntimeHealth", () => {
  test("stops waiting when fetch ignores its abort signal", async () => {
    const startedAt = performance.now();
    const healthy = await pollHttpRuntimeHealth({
      url: "https://runtime.example.com",
      timeoutMs: 20,
      intervalMs: 1,
      fetch: () => new Promise<Response>(() => {}),
    });

    expect(healthy).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test("checks provider state after an unhealthy response", async () => {
    let checked = false;

    await expect(
      pollHttpRuntimeHealth({
        url: "https://runtime.example.com",
        timeoutMs: 100,
        intervalMs: 1,
        fetch: async () => new Response(null, { status: 502 }),
        onUnhealthy: () => {
          checked = true;
          throw new Error("provider crashed");
        },
      }),
    ).rejects.toThrow("provider crashed");
    expect(checked).toBe(true);
  });
});
