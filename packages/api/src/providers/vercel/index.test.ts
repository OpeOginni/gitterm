import { describe, expect, test } from "bun:test";

describe("Vercel environment", () => {
  test("does not send container provisioning manifests to Sandbox.create", async () => {
    const { VercelProvider } = await import(".");
    const environment = (new VercelProvider() as any).getEnvironment(
      {
        environmentVariables: {
          AGENT_FILES_BASE64: "large-manifest",
          WORKSPACE_TOOLING_MANIFEST_BASE64: "large-tooling-manifest",
          WORKSPACE_BEFORE_AGENT_COMMAND_BASE64: "x".repeat(8_000),
          WORKSPACE_SETUP_COMMAND_BASE64: "y".repeat(8_000),
          WORKSPACE_API_URL: "https://api.example.com",
          WORKSPACE_SETUP_AUTH_TOKEN: "setup-token",
          CUSTOM_VALUE: "preserved",
        },
      },
      { agent: { env: { OPENCODE_SERVER_PASSWORD: "password" } } },
    );

    expect(environment).toEqual({
      WORKSPACE_API_URL: "https://api.example.com",
      WORKSPACE_SETUP_AUTH_TOKEN: "setup-token",
      CUSTOM_VALUE: "preserved",
      OPENCODE_SERVER_PASSWORD: "password",
    });
    expect(Buffer.byteLength(JSON.stringify(environment))).toBeLessThan(4096);
  });

  test("submits post-start setup with the agent server", async () => {
    const { VercelProvider } = await import(".");
    const commands: Record<string, unknown>[] = [];
    const files: unknown[] = [];
    const sandbox = {
      writeFiles: async (input: unknown[]) => {
        files.push(...input);
      },
      runCommand: async (input: Record<string, unknown>) => {
        commands.push(input);
        return { exitCode: 0, stderr: async () => "" };
      },
    };

    await (new VercelProvider() as any).startAgentServer(
      sandbox,
      "/repo",
      { command: "opencode serve", port: 4096 },
      "run setup",
    );

    expect(files).toEqual([
      {
        path: "/tmp/gitterm-agent-post-start.sh",
        content: Buffer.from("run setup"),
        mode: 0o700,
      },
    ]);
    expect(commands[0]).toEqual({
      cmd: "bash",
      args: [
        "-lc",
        'opencode serve > /tmp/agent-server.log 2>&1 & agent_pid=$!; /tmp/gitterm-agent-post-start.sh > /tmp/agent-post-start.log 2>&1; wait "$agent_pid"',
      ],
      cwd: "/repo",
      detached: true,
    });
    expect(commands[1]).toMatchObject({ cwd: "/repo" });
  });
});
