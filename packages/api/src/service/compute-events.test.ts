import { expect, test } from "bun:test";
import { followComputeEvents } from "./compute-events";

test("the sandbox event stream is parsed across chunks and resumed after a drop", async () => {
  const requests: string[] = [];
  let connection = 0;
  const encoder = new TextEncoder();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(request) {
      requests.push(`${new URL(request.url).search} ${request.headers.get("authorization")}`);
      const first = connection++ === 0;
      const stream = new ReadableStream({
        async start(controller) {
          if (first) {
            const message =
              'id: 7\nevent: job.finished\ndata: {"seq":7,"sandboxId":"sbx_a","type":"job.finished","data":{"jobId":"job_1","status":"failed","exitCode":2}}\n\n';
            // Split mid-message, as the network may.
            controller.enqueue(encoder.encode(message.slice(0, 40)));
            await Bun.sleep(20);
            controller.enqueue(encoder.encode(message.slice(40)));
            controller.enqueue(encoder.encode("event: ping\ndata: \n\n"));
            controller.enqueue(
              encoder.encode('id: 8\nevent: sandbox.terminated\ndata: {"seq":8}\n\n'),
            );
            controller.close(); // the connection drops
          } else {
            controller.enqueue(
              encoder.encode(
                'id: 9\nevent: job.finished\ndata: {"sandboxId":"sbx_b","data":{"jobId":"job_2","status":"succeeded","exitCode":0}}\n\n',
              ),
            );
          }
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const seen: unknown[] = [];
  const controller = new AbortController();
  const following = followComputeEvents({
    url: `http://127.0.0.1:${server.port}/`,
    serviceToken: "secret",
    onJobFinished: (event) => void seen.push(event),
    signal: controller.signal,
  });
  for (let i = 0; i < 100 && seen.length < 2; i++) await Bun.sleep(30);
  controller.abort();
  await following;
  server.stop(true);
  expect(seen).toEqual([
    {
      seq: 7,
      sandboxId: "sbx_a",
      type: "job.finished",
      data: { jobId: "job_1", status: "failed", exitCode: 2 },
    },
    { sandboxId: "sbx_b", data: { jobId: "job_2", status: "succeeded", exitCode: 0 } },
  ]);
  // Starts from new events, then resumes after the last one it saw.
  expect(requests).toEqual(["?after=latest Bearer secret", "?after=8 Bearer secret"]);
}, 15_000);

test("a first event whose delivery fails is delivered again, and the old stream is closed", async () => {
  const requests: string[] = [];
  let firstClosed = false;
  const encoder = new TextEncoder();
  const event =
    'id: 7\nevent: job.finished\ndata: {"sandboxId":"sbx_a","data":{"jobId":"job_1","status":"failed","exitCode":2}}\n\n';
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(request) {
      const after = new URL(request.url).searchParams.get("after")!;
      requests.push(after);
      const stream = new ReadableStream({
        start(controller) {
          // Only events after `after`, like Compute; then stay open, as a live stream does.
          if (after === "latest" || Number(after) < 7) controller.enqueue(encoder.encode(event));
        },
        cancel() {
          if (requests.length === 1) firstClosed = true;
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const seen: string[] = [];
  let failures = 1;
  const controller = new AbortController();
  const following = followComputeEvents({
    url: `http://127.0.0.1:${server.port}`,
    serviceToken: "secret",
    onJobFinished: (received) => {
      if (failures-- > 0) throw new Error("database unavailable");
      seen.push(received.data!.jobId!);
    },
    signal: controller.signal,
  });
  for (let i = 0; i < 100 && seen.length < 1; i++) await Bun.sleep(30);
  controller.abort();
  await following;
  server.stop(true);
  expect(seen).toEqual(["job_1"]);
  expect(requests.slice(0, 2)).toEqual(["latest", "6"]);
  expect(firstClosed).toBe(true);
}, 15_000);
