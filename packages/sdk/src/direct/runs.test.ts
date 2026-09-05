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

for (const api of ["v1", "v2"] as const) {
  describe(`${api} direct run interaction`, () => {
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
            `data: ${JSON.stringify(
              api === "v1"
                ? {
                    type: "session.status",
                    properties: {
                      sessionID: "ses_test",
                      status: { type: phase === "done" ? "idle" : "busy" },
                    },
                  }
                : {
                    type: "session.status",
                    data: {
                      sessionID: "ses_test",
                      status: { type: phase === "done" ? "idle" : "busy" },
                    },
                  },
            )}\n\n`,
          ),
        );
      const fetchStub = (async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const path = url.pathname;
        expect(request.headers.get("x-routing-token")).toBe("route");
        if (path === "/event" || path === "/api/event") {
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
          if (path === "/session") return Response.json({ id: "ses_test", title: "test" });
          if (path === "/api/session")
            return Response.json({ data: { id: "ses_test", title: "test" } });
          if (path.endsWith("/prompt_async")) messageId = body.messageID as string;
          if (path.endsWith("/prompt")) messageId = body.id as string;
          if (
            path.includes("/reply") ||
            path.includes("/permissions/per_test") ||
            path.endsWith("/reject") ||
            path.endsWith("/cancel")
          ) {
            phase = "done";
            emit();
          }
          return Response.json(true);
        }
        if (path === "/session/ses_test") return Response.json({ id: "ses_test" });
        if (path === "/api/session/ses_test") return Response.json({ data: { id: "ses_test" } });
        if (path === "/session/status")
          return Response.json(phase === "done" ? {} : { ses_test: { type: "busy" } });
        if (path === "/api/session/active")
          return Response.json({ data: phase === "done" ? {} : { ses_test: {} } });
        if (path.endsWith("/permission")) {
          const permissions =
            phase === "permission"
              ? [
                  api === "v1"
                    ? {
                        id: "per_test",
                        sessionID: "ses_test",
                        permission: "bash",
                        patterns: ["echo hi"],
                        always: ["echo *"],
                      }
                    : { id: "per_test", action: "shell", resources: ["echo hi"], save: ["echo *"] },
                ]
              : [];
          return Response.json(api === "v1" ? permissions : { data: permissions });
        }
        const question = {
          id: "que_test",
          sessionID: "ses_test",
          questions: [
            {
              header: "Choice",
              question: "Which?",
              options: [{ label: "Production", description: "" }],
            },
          ],
        };
        if (path === "/question") return Response.json(phase === "question" ? [question] : []);
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
          if (api === "v1")
            return Response.json([
              { info: { id: messageId, role: "user", time: { created: now } }, parts: [] },
              {
                info: {
                  id: "assistant",
                  role: "assistant",
                  parentID: messageId,
                  time: { created: now, completed: now },
                },
                parts: [{ type: "text", text: phase === "done" ? "Finished" : "Working" }],
              },
            ]);
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
      const workspace = await client.workspaces.create(api === "v1" ? {} : { opencode: { api } });
      expect(workspace.opencodeApi).toBe(api);
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
      expect(f.posts.find((post) => post.path.endsWith("/reply"))?.body).toEqual(
        api === "v1" ? { answers: [["Production"]] } : { answer: { env: "prod" } },
      );
      expect(f.closed()).toBe(true);
    });

    test("a wait timeout closes SSE without cancelling the agent", async () => {
      const f = fixture();
      const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
      const workspace = await client.workspaces.create({ opencode: { api } });
      const run = await client.runs.create({ workspace, prompt: "hi" });
      await expect(client.runs.wait(run, { timeoutMs: 20 })).rejects.toMatchObject({
        code: "TIMEOUT",
      });
      expect(f.closed()).toBe(true);
      expect(
        f.posts.some((post) => post.path.endsWith("/abort") || post.path.endsWith("/interrupt")),
      ).toBe(false);
    });

    test("permission approvals use the selected protocol", async () => {
      const f = fixture();
      const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
      const workspace = await client.workspaces.create({ opencode: { api } });
      const run = await client.runs.create({ workspace, prompt: "hi" });
      f.ask("permission");
      const result = await client.runs.result(run, {
        timeoutMs: 1_000,
        onPermission: () => "once",
      });
      expect(result.status).toBe("completed");
      expect(f.posts.find((post) => post.path.includes("per_test"))?.body).toEqual(
        api === "v1" ? { response: "once" } : { reply: "once" },
      );
    });

    test("malformed question replies never become implicit rejections", async () => {
      const f = fixture();
      const client = createDirectGittermClient({ provider, fetch: f.fetchStub });
      const workspace = await client.workspaces.create({ opencode: { api } });
      const run = await client.runs.create({ workspace, prompt: "hi" });
      f.ask();
      await expect(
        client.runs.respond(run, { requestId: "que_test", reply: { type: "question" } as never }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        f.posts.some((post) => post.path.endsWith("/reject") || post.path.endsWith("/cancel")),
      ).toBe(false);
      await client.runs.respond(run, {
        requestId: "que_test",
        reply: { type: "question", reject: true },
      });
      expect(f.posts.some((post) => post.path.endsWith(api === "v1" ? "/reject" : "/cancel"))).toBe(
        true,
      );
    });
  });
}
