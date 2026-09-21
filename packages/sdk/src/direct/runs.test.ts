import { describe, expect, test } from "bun:test";
import { createDirectGittermClient } from "./client";
import type { DirectProviderAdapter } from "./types";

const provider: DirectProviderAdapter = {
  name: "test",
  capabilities: {
    persistence: "supported",
    recommendedLifecycle: "ephemeral",
    supportsPause: false,
    supportsKeepAlive: false,
    ephemeralPause: "unsupported",
  },
  async create() {
    return {
      externalId: "test",
      runtime: {
        url: "https://runtime.test",
        directory: "/repo",
        headers: { "x-routing-token": "route" },
      },
    };
  },
  async status() {
    return "running";
  },
  async terminate() {},
};

describe("direct run interaction", () => {
  function fixture() {
    let messageId = "";
    let phase: "tool" | "question" | "permission" | "done" = "tool";
    const posts: Array<{ path: string; body: unknown }> = [];
    let connection: ReadableStreamDefaultController<Uint8Array> | undefined;
    let streamClosed = false;
    const encoder = new TextEncoder();
    const emit = () =>
      connection?.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "session.status",
            data: {
              sessionID: "ses_test",
              status: { type: phase === "done" ? "idle" : "busy" },
            },
          })}\n\n`,
        ),
      );
    const fetchStub = (async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const path = url.pathname;
      expect(request.headers.get("x-routing-token")).toBe("route");
      if (path === "/api/event") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              connection = controller;
            },
            cancel() {
              streamClosed = true;
              connection = undefined;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (request.method === "POST") {
        const text = await request.text();
        const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
        posts.push({ path, body });
        if (path === "/api/session")
          return Response.json({ data: { id: "ses_test", title: "test" } });
        if (path.endsWith("/prompt")) messageId = body.id as string;
        if (
          path.includes("/reply") ||
          path.includes("/permissions/per_test") ||
          path.endsWith("/cancel")
        ) {
          phase = "done";
          emit();
        }
        return Response.json(true);
      }
      if (path === "/api/session/ses_test") return Response.json({ data: { id: "ses_test" } });
      if (path === "/api/session/active")
        return Response.json({ data: phase === "done" ? {} : { ses_test: {} } });
      if (path.endsWith("/permission")) {
        return Response.json({
          data:
            phase === "permission"
              ? [{ id: "per_test", action: "shell", resources: ["echo hi"], save: ["echo *"] }]
              : [],
        });
      }
      if (path.endsWith("/form"))
        return Response.json({
          data:
            phase === "question"
              ? [
                  {
                    id: "que_test",
                    fields: [
                      {
                        key: "env",
                        title: "Choice",
                        description: "Which?",
                        type: "string",
                        options: [{ label: "Production", value: "prod" }],
                      },
                    ],
                  },
                ]
              : [],
        });
      if (path.endsWith("/message")) {
        const now = Date.now();
        // A completed intermediate assistant message is NOT a completed agent run.
        return Response.json({
          data: [
            { id: messageId, type: "user", time: { created: now }, text: "hi" },
            {
              id: "assistant",
              type: "assistant",
              time: { created: now, completed: now },
              content: [{ type: "text", text: phase === "done" ? "Finished" : "Working" }],
            },
          ],
        });
      }
      throw new Error(`Unexpected ${request.method} ${path}`);
    }) as typeof fetch;
    return {
      fetchStub,
      posts,
      ask(kind: "question" | "permission" = "question") {
        phase = kind;
        emit();
      },
      closed: () => streamClosed,
    };
  }

  test("completion waits for the agent, then questions and SSE yield a final result", async () => {
    const f = fixture();
    const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
    const workspace = await client.workspaces.create();
    const run = await client.runs.create({ workspace, prompt: "hi", model: "openai/test" });
    expect((await client.runs.get(run)).status).toBe("running");
    f.ask();
    let asked = 0;
    const result = await client.runs.result(run, {
      timeoutMs: 1_000,
      onQuestion(request) {
        asked++;
        return { answers: { [request.questions[0]!.key]: ["Production"] } };
      },
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Finished");
    expect(asked).toBe(1);
    expect(f.posts.find((post) => post.path.endsWith("/reply"))?.body).toEqual({
      answer: { env: "prod" },
    });
    expect(f.closed()).toBe(true);
  });

  test("a wait timeout closes SSE without cancelling the agent", async () => {
    const f = fixture();
    const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
    const workspace = await client.workspaces.create();
    const run = await client.runs.create({ workspace, prompt: "hi" });
    await expect(client.runs.wait(run, { timeoutMs: 20 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(f.closed()).toBe(true);
    expect(f.posts.some((post) => post.path.endsWith("/interrupt"))).toBe(false);
  });

  test("permission approvals use the OpenCode reply protocol", async () => {
    const f = fixture();
    const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
    const workspace = await client.workspaces.create();
    const run = await client.runs.create({ workspace, prompt: "hi" });
    f.ask("permission");
    const result = await client.runs.result(run, {
      timeoutMs: 1_000,
      onPermission: () => "once",
    });
    expect(result.status).toBe("completed");
    expect(f.posts.find((post) => post.path.includes("per_test"))?.body).toEqual({
      reply: "once",
    });
  });

  test("malformed question replies never become implicit rejections", async () => {
    const f = fixture();
    const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
    const workspace = await client.workspaces.create();
    const run = await client.runs.create({ workspace, prompt: "hi" });
    f.ask();
    await expect(
      client.runs.respond(run, { requestId: "que_test", reply: { type: "question" } as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.posts.some((post) => post.path.endsWith("/cancel"))).toBe(false);
    await client.runs.respond(run, {
      requestId: "que_test",
      reply: { type: "question", reject: true },
    });
    expect(f.posts.some((post) => post.path.endsWith("/cancel"))).toBe(true);
  });
});
