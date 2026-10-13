import { describe, expect, test } from "bun:test";
import { opencodeAttachCommand } from "./opencode-connection";

describe("OpenCode attach commands", () => {
  test("uses the paired credential instead of an implicit password", () => {
    expect(opencodeAttachCommand("https://workspace.gitterm.dev", "session-token")).toBe(
      "OPENCODE_PASSWORD='session-token' opencode --server 'https://workspace.gitterm.dev'",
    );
  });

  test("quotes credentials and URLs without allowing shell expansion", () => {
    const credential = "token'with$(echo injected)";
    const url = "https://example.test/ws/a'b; echo injected";
    const command = opencodeAttachCommand(url, credential);
    const result = Bun.spawnSync([
      "/bin/sh",
      "-c",
      `opencode() { printf '%s\\n' "$OPENCODE_PASSWORD" "$1" "$2"; }; ${command}`,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(`${credential}\n--server\n${url}\n`);
  });
});
