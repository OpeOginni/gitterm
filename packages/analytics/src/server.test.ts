import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { createServerErrorTracking } from "./server";

describe("server exception transport", () => {
  test("disabled/unconfigured deployments and expected failures send nothing", async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        throw new Error("Unexpected network access");
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      await createServerErrorTracking({
        enabled: false,
        key: "phc_test",
        host: "https://posthog.invalid",
      }).captureException(new Error("private"));
      await createServerErrorTracking({ enabled: true }).captureException(new Error("private"));
      await createServerErrorTracking({
        enabled: true,
        key: "phc_test",
        host: "https://posthog.invalid",
      }).captureException({ code: "FORBIDDEN" });
      expect(requests).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the real SDK sends only rebuilt properties and a service identity", async () => {
    const originalFetch = globalThis.fetch;
    const batches: {
      batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[];
    }[] = [];
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        const body = new Uint8Array(await request.arrayBuffer());
        const decoded =
          request.headers.get("content-encoding") === "gzip" ? gunzipSync(body) : body;
        batches.push(JSON.parse(new TextDecoder().decode(decoded)));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      const tracking = createServerErrorTracking({
        enabled: true,
        key: "phc_test",
        host: "https://posthog.invalid",
      });
      const error = new TypeError("private-message", { cause: new Error("private-cause") });
      error.stack =
        "TypeError: private-message\n    at privateFunction (/app/private-repository/index.mjs:20:12)\n    at secret (/Users/private-repository/source.ts:1:2)";
      await tracking.captureException(error);
      const events = batches.flatMap((batch) => batch.batch);
      expect(events).toHaveLength(1);
      const payload = JSON.stringify(events);
      expect(payload).not.toContain("private");
      expect(payload).not.toContain("secret");
      expect(events[0]?.event).toBe("$exception");
      expect(events[0]?.properties.service).toBe("server");
      expect(events[0]?.distinct_id).toBe("service:server");
      expect(events[0]?.properties.$process_person_profile).toBe(false);
      expect(payload).toContain("index.mjs");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
