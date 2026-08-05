import { describe, expect, test } from "bun:test";
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

  test("is detached and restart-safe", () => {
    const command = buildWorkspaceSetupCommand(["true"]);

    expect(command).toContain('mkdir "$SETUP_DIR/claim"');
    expect(command).toEndWith(") >/dev/null 2>&1 &");
  });
});
