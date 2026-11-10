import { afterAll, expect, test } from "bun:test";
import { createGittermComputeTransport } from "./gitterm";

/** Managed-provider failures are not user credential errors. */
let reply = () => new Response("{}");
const compute = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => reply() });
afterAll(() => compute.stop(true));
const transport = createGittermComputeTransport({
  url: `http://127.0.0.1:${compute.port}`,
  serviceToken: "token",
});

test("a rejected service token says which setting to fix", async () => {
  reply = () => Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  await expect(transport.list({})).rejects.toMatchObject({
    code: "provider",
    message: expect.stringContaining("COMPUTE_SERVICE_TOKEN"),
  });
});

test("managed provider key failures pass through as Gitterm failures", async () => {
  reply = () =>
    Response.json(
      { error: { code: "auth", message: "No small machine could be started right now." } },
      { status: 502 },
    );
  await expect(transport.list({})).rejects.toMatchObject({
    code: "provider",
    message: "No small machine could be started right now.",
  });
});

test("an unreachable managed provider is reported as such", async () => {
  const offline = createGittermComputeTransport({ url: "http://127.0.0.1:9", serviceToken: "t" });
  await expect(offline.list({})).rejects.toMatchObject({
    code: "provider",
    message: expect.stringContaining("Gitterm could not be reached"),
  });
});
