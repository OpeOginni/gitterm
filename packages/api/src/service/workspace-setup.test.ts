import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspaceSetupCommand } from "./workspace-setup";

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

  test("runs after an authenticated readiness response and stale claim", async () => {
    const home = await mkdtemp(join(tmpdir(), "gitterm-setup-"));
    const claim = join(home, ".gitterm/setup/claim");
    await mkdir(claim, { recursive: true });
    await writeFile(join(claim, "boot-id"), "stale\n");
    await writeFile(join(claim, "pid"), "999999\n");
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("Unauthorized", { status: 401 }),
    });

    try {
      const command = buildWorkspaceSetupCommand(['printf done > "$HOME/done"'], server.port);
      const process = Bun.spawn(["bash", "-lc", command!], {
        env: { ...Bun.env, HOME: home },
        stdout: "ignore",
        stderr: "ignore",
      });
      await process.exited;

      let state = "";
      for (let attempt = 0; attempt < 50 && state !== "succeeded"; attempt++) {
        await Bun.sleep(20);
        state = await readFile(join(home, ".gitterm/setup/state"), "utf8").catch(() => "");
        state = state.trim();
      }

      expect(state).toBe("succeeded");
      expect(await readFile(join(home, "done"), "utf8")).toBe("done");
    } finally {
      server.stop(true);
      await rm(home, { recursive: true, force: true });
    }
  });
});
