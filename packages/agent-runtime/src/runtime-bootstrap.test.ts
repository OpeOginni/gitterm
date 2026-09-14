import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("runtime bootstrap authenticates and emits shell-safe exports", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      expect(new URL(request.url).pathname).toBe("/trpc/workspaceOps.runtimeBundle");
      expect(request.headers.get("authorization")).toBe("Bearer bootstrap-token");
      return Response.json({
        result: {
          data: {
            json: { environment: { SIMPLE: "value", TRICKY: "line one\nquote ' value" } },
          },
        },
      });
    },
  });
  try {
    const child = Bun.spawn(
      ["node", resolve(import.meta.dir, "../../../.docker/runtime-bootstrap.mjs")],
      {
        env: {
          ...process.env,
          WORKSPACE_API_URL: `${server.url}trpc`,
          WORKSPACE_AGENT_AUTH_TOKEN: "bootstrap-token",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exports, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const shell = Bun.spawn(["sh", "-c", `${exports}\nprintf '%s\\0%s' "$SIMPLE" "$TRICKY"`], {
      stdout: "pipe",
    });
    expect(await new Response(shell.stdout).text()).toBe("value\0line one\nquote ' value");
    expect(await shell.exited).toBe(0);
  } finally {
    server.stop(true);
  }
});
