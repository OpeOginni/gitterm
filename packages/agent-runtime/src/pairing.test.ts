import { describe, expect, test } from "bun:test";
import { createOpencodeConnection } from "./pairing";
import { RuntimeHttpError, type RuntimeConnection } from "./http";

async function withServer(
  handler: (request: Request) => Response,
  run: (target: RuntimeConnection) => Promise<void>,
) {
  const server = Bun.serve({ port: 0, fetch: handler });
  try {
    await run({ url: server.url.toString(), password: "server-secret" });
  } finally {
    server.stop(true);
  }
}

describe("OpenCode connection credentials", () => {
  test("issues a fresh single-use link without redeeming it or exposing the password", async () => {
    let issued = 0;
    await withServer(
      (request) => {
        expect(new URL(request.url).pathname).toBe("/api/pair");
        expect(request.method).toBe("POST");
        expect(request.headers.get("authorization")).toBe(
          `Basic ${btoa("opencode:server-secret")}`,
        );
        return Response.json({ code: `code_${++issued}`, expires_in: 300 });
      },
      async (target) => {
        const before = Date.now();
        const first = await createOpencodeConnection(target, "link");
        const second = await createOpencodeConnection(target, "link");
        expect(first.kind).toBe("link");
        if (first.kind !== "link" || second.kind !== "link") throw new Error("Expected links");
        expect(first.link).toBe(`${target.url.replace(/\/$/, "")}/auth/connect/code_1`);
        expect(second.link).toEndWith("/auth/connect/code_2");
        expect(Date.parse(first.expiresAt)).toBeGreaterThanOrEqual(before + 300_000);
        expect(JSON.stringify(first)).not.toContain("server-secret");
        expect(issued).toBe(2);
      },
    );
  });

  test("redeems its own code as JSON and returns only the TUI session token", async () => {
    const paths: string[] = [];
    await withServer(
      (request) => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        if (path === "/api/pair") return Response.json({ code: "tui-code", expires_in: 300 });
        expect(path).toBe("/auth/connect/tui-code");
        expect(request.method).toBe("GET");
        expect(request.headers.get("accept")).not.toContain("text/html");
        return Response.json({ token: "paired-session-token" });
      },
      async (target) => {
        const connection = await createOpencodeConnection(target, "tui");
        expect(connection).toEqual({
          kind: "tui",
          url: target.url.replace(/\/$/, ""),
          token: "paired-session-token",
        });
        expect(JSON.stringify(connection)).not.toContain("server-secret");
        expect(paths).toEqual(["/api/pair", "/auth/connect/tui-code"]);
      },
    );
  });

  test("rejects prefixed GUI links before issuing an unusable code", async () => {
    await expect(
      createOpencodeConnection(
        { url: "https://example.test/ws/workspace", password: "secret" },
        "link",
      ),
    ).rejects.toThrow("Use the server URL and password");
  });

  test("preserves proxy prefixes when redeeming a TUI connection", async () => {
    const paths: string[] = [];
    await withServer(
      (request) => {
        const path = new URL(request.url).pathname;
        paths.push(path);
        return Response.json(
          path.endsWith("/api/pair")
            ? { code: "code", expires_in: 300 }
            : { token: "session-token" },
        );
      },
      async (target) => {
        const result = await createOpencodeConnection(
          { ...target, url: `${target.url}ws/example` },
          "tui",
        );
        expect(result.kind).toBe("tui");
        expect(paths).toEqual(["/ws/example/api/pair", "/ws/example/auth/connect/code"]);
      },
    );
  });

  test("surfaces unsupported pairing without falling back to returning the master password", async () => {
    await withServer(
      () => Response.json({ message: "missing" }, { status: 404 }),
      async (target) => {
        await expect(createOpencodeConnection(target, "link")).rejects.toBeInstanceOf(
          RuntimeHttpError,
        );
      },
    );
  });

  test("does not return a credential when code redemption is rejected", async () => {
    await withServer(
      (request) =>
        Response.json(
          new URL(request.url).pathname === "/api/pair"
            ? { code: "expired", expires_in: 300 }
            : { message: "expired" },
          { status: new URL(request.url).pathname === "/api/pair" ? 200 : 401 },
        ),
      async (target) => {
        await expect(createOpencodeConnection(target, "tui")).rejects.toBeInstanceOf(
          RuntimeHttpError,
        );
      },
    );
  });
});
