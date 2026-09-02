import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AWS_CLI_SETUP_COMMAND,
  buildWorkspaceSetupCommand,
  withWorkspaceSetupPort,
} from "./workspace-setup";

test("AWS CLI setup persists the install across container replacements", () => {
  expect(AWS_CLI_SETUP_COMMAND).toContain('--install-dir "$aws_install_dir"');
  expect(AWS_CLI_SETUP_COMMAND).toContain('--bin-dir "$aws_bin_dir"');
  expect(AWS_CLI_SETUP_COMMAND).toContain("$HOME/.gitterm/aws-cli");
  expect(AWS_CLI_SETUP_COMMAND).toContain("$HOME/.bun/bin");
});

describe("buildWorkspaceSetupCommand", () => {
  test("returns undefined without commands", () => {
    expect(buildWorkspaceSetupCommand([])).toBeUndefined();
  });

  test("encodes commands without interpolating their contents", () => {
    const command = buildWorkspaceSetupCommand(["echo 'secret'", "npm install"]);

    expect(command).toContain("base64 -d");
    expect(command).toContain("setup.log");
    expect(command).toContain("bash -e");
    expect(command).not.toContain("echo 'secret'");
  });

  test("is detached and recovers abandoned claims", () => {
    const command = buildWorkspaceSetupCommand(["true"]);

    expect(command).toContain('mkdir "$SETUP_DIR/claim"');
    expect(command).toContain('kill -0 "$OLD_PID"');
    expect(command).toContain('rm -rf "$SETUP_DIR/claim"');
    expect(command).toContain("[234][0-9][0-9]");
    expect(command).toEndWith(") >/dev/null 2>&1 &");
  });

  test("uses a scoped callback token and explicit runtime port", () => {
    const command = buildWorkspaceSetupCommand(["true"], 4096, {
      executionId: "00000000-0000-4000-8000-000000000000",
    });
    expect(command).toContain("workspaceOps.reportSetupStatus");
    expect(command).toContain("WORKSPACE_SETUP_AUTH_TOKEN");
    expect(command).toContain("WORKSPACE_SETUP_PORT");
    expect(command).toContain("00000000-0000-4000-8000-000000000000");
    expect(command).not.toContain("WORKSPACE_AUTH_TOKEN");
  });

  test("runs after an authenticated readiness response and stale claim", async () => {
    const home = await mkdtemp(join(tmpdir(), "gitterm-setup-"));
    const claim = join(home, ".gitterm/setup/after-agent/claim");
    await mkdir(claim, { recursive: true });
    await mkdir(join(home, ".git/info"), { recursive: true });
    await writeFile(join(claim, "boot-id"), "stale\n");
    await writeFile(join(claim, "pid"), "999999\n");
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("Unauthorized", { status: 401 }),
    });

    try {
      const command = buildWorkspaceSetupCommand(['printf done > "$HOME/done"'], server.port);
      const process = Bun.spawn(["bash", "-lc", command!], {
        cwd: home,
        env: { ...Bun.env, HOME: home, PORT: String(server.port) },
        stdout: "ignore",
        stderr: "ignore",
      });
      await process.exited;

      let state = "";
      for (let attempt = 0; attempt < 50 && state !== "succeeded"; attempt++) {
        await Bun.sleep(20);
        state = await readFile(join(home, ".gitterm/setup/after-agent/state"), "utf8").catch(
          () => "",
        );
        state = state.trim();
      }

      expect(state).toBe("succeeded");
      expect(await readFile(join(home, "done"), "utf8")).toBe("done");
      expect(await readFile(join(home, ".git/info/exclude"), "utf8")).toContain("/.gitterm/");
    } finally {
      server.stop(true);
      await rm(home, { recursive: true, force: true });
    }
  });

  test("reports provider-neutral setup state", async () => {
    const home = await mkdtemp(join(tmpdir(), "gitterm-setup-report-"));
    const reports: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/workspaceOps.reportSetupStatus") {
          expect(request.headers.get("authorization")).toBe("Bearer setup-token");
          reports.push((await request.json()) as Record<string, unknown>);
          return new Response(null, { status: 200 });
        }
        return new Response("Unauthorized", { status: 401 });
      },
    });

    try {
      const executionId = "00000000-0000-4000-8000-000000000000";
      const command = buildWorkspaceSetupCommand(["printf report-ok"], server.port, {
        executionId,
      });
      const process = Bun.spawn(["bash", "-lc", command!], {
        cwd: home,
        env: {
          ...Bun.env,
          PORT: String(server.port),
          WORKSPACE_API_URL: `http://127.0.0.1:${server.port}`,
          WORKSPACE_SETUP_AUTH_TOKEN: "setup-token",
        },
        stdout: "ignore",
        stderr: "ignore",
      });
      await process.exited;

      for (let attempt = 0; attempt < 50 && reports.length < 2; attempt++) {
        await Bun.sleep(20);
      }

      expect(reports.map((report) => report.status)).toEqual(["running", "succeeded"]);
      expect(reports.every((report) => report.executionId === executionId)).toBe(true);
      expect(Buffer.from(String(reports[1]?.logBase64), "base64").toString()).toBe("report-ok");
    } finally {
      server.stop(true);
      await rm(home, { recursive: true, force: true });
    }
  });

  test("builds a blocking before-agent phase without a readiness probe", () => {
    const command = buildWorkspaceSetupCommand(["true"], 4096, {
      phase: "before-agent",
      waitForAgent: false,
      detached: false,
      failOnError: true,
    });

    expect(command).toContain(".gitterm/setup/before-agent");
    expect(command).not.toContain("WORKSPACE_SETUP_PORT");
    expect(command).toEndWith(")");
    expect(command).toContain('exit "$code"');
  });
});

test("workspace setup port wrapper is valid shell syntax", async () => {
  const command = withWorkspaceSetupPort("( true ) >/dev/null 2>&1 &", 4096);
  const process = Bun.spawn(["bash", "-n", "-c", command], { stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(command).toStartWith("export WORKSPACE_SETUP_PORT=4096\n");
});
