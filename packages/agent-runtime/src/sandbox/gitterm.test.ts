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

test("snapshots are saved, started from and deleted through Compute", async () => {
  const requests: Array<{ call: string; body: unknown }> = [];
  const service = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      requests.push({ call: `${request.method} ${pathname}`, body });
      if (pathname === "/v1/sandboxes/sbx1/snapshots") return Response.json({ id: "snap1" });
      if (pathname === "/v1/snapshots/gone")
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ id: "sbx2", state: "running", labels: {} });
    },
  });
  try {
    const compute = createGittermComputeTransport({
      url: `http://127.0.0.1:${service.port}`,
      serviceToken: "token",
    });
    expect(await compute.snapshots!.create("sbx1", "gitterm-abc")).toBe("snap1");
    await compute.create({
      labels: {},
      timeoutMs: 60_000,
      machine: { size: "medium" },
      snapshot: "snap1",
    });
    await compute.snapshots!.delete("snap1");
    // One that is already gone counts as deleted.
    await compute.snapshots!.delete("gone");
    expect(requests.map((request) => request.call)).toEqual([
      "POST /v1/sandboxes/sbx1/snapshots",
      "POST /v1/sandboxes",
      "DELETE /v1/snapshots/snap1",
      "DELETE /v1/snapshots/gone",
    ]);
    expect(requests[0]!.body).toEqual({ name: "gitterm-abc" });
    expect(requests[1]!.body).toMatchObject({ size: "medium", snapshot: "snap1" });
  } finally {
    service.stop(true);
  }
});
