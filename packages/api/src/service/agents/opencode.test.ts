import { describe, expect, test } from "bun:test";
import { buildOpencodeConfigJson, opencodeProvisioner } from "./opencode";

describe("OpenCode workspace capabilities", () => {
  test("preserves configured plugin tuples and appends selected plugins", () => {
    const config = JSON.parse(
      buildOpencodeConfigJson(
        { plugin: [["existing-plugin", { mode: "safe" }], "same-plugin"] },
        "User",
        ["same-plugin", "selected-plugin@1.2.3"],
      ),
    );

    expect(config.plugin).toEqual([
      ["existing-plugin", { mode: "safe" }],
      "same-plugin",
      "selected-plugin@1.2.3",
    ]);
  });

  test("materializes GitTerm instructions and selected skills globally", () => {
    const provisioned = opencodeProvisioner.provision({
      userId: "user",
      userDisplayName: "User",
      workspaceHostname: "workspace.example.com",
      agentTypeName: "OpenCode",
      serverOnly: true,
      credentials: [],
      opencode: {
        skills: [{ name: "browser-demo", content: "---\nname: browser-demo\n---\nDemo" }],
      },
    });

    expect(provisioned.files.map((file) => file.path)).toContain("~/.config/opencode/AGENTS.md");
    expect(provisioned.files.map((file) => file.path)).toContain(
      "~/.config/opencode/skills/browser-demo/SKILL.md",
    );
  });
});
