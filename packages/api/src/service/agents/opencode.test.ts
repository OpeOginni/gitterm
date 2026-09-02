import { describe, expect, test } from "bun:test";
import {
  buildAwsRuntimeInstructions,
  buildGittermInstructions,
  buildOpencodeConfigJson,
  opencodeProvisioner,
} from "./opencode";

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
        skills: [
          {
            name: "browser-demo",
            content: "---\nname: browser-demo\n---\nDemo",
          },
        ],
      },
    });

    expect(provisioned.files.map((file) => file.path)).toContain("~/.config/opencode/AGENTS.md");
    expect(provisioned.files.map((file) => file.path)).toContain(
      "~/.config/opencode/skills/browser-demo/SKILL.md",
    );
  });

  test("appends trusted integration instructions after GitTerm instructions", () => {
    const provisioned = opencodeProvisioner.provision({
      userId: "user",
      userDisplayName: "User",
      workspaceHostname: "workspace.example.com",
      agentTypeName: "OpenCode",
      serverOnly: true,
      credentials: [],
      additionalAgentInstructions: "You are operating as a Slack bot.",
    });
    const file = provisioned.files.find((item) => item.path === "~/.config/opencode/AGENTS.md");
    const content = Buffer.from(file!.contentBase64, "base64").toString();

    expect(content).toBe(buildGittermInstructions("You are operating as a Slack bot."));
    expect(content.indexOf("GitTerm workspace")).toBeLessThan(content.indexOf("Slack bot"));
  });

  test("summarizes AWS runtime and IAM boundaries without policy documents", () => {
    const content = buildAwsRuntimeInstructions({
      region: "eu-central-1",
      location: "Frankfurt, Germany",
      taskRoleArn: "arn:aws:iam::123456789012:role/gitterm-task-eu-central-1",
    });

    expect(content).toContain("AWS ECS in `eu-central-1` (Frankfurt, Germany)");
    expect(content).toContain("temporary ECS task-role credentials");
    expect(content).toContain(
      "inspect attached and inline policies for role `gitterm-task-eu-central-1`",
    );
    expect(content).toContain("ask for that permission");
    expect(content).not.toContain("Policy Document");
  });

  test("merges request config over the saved config, request wins per key", () => {
    const provisioned = opencodeProvisioner.provision({
      userId: "user",
      userDisplayName: "User",
      workspaceHostname: "workspace.example.com",
      agentTypeName: "OpenCode",
      serverOnly: true,
      credentials: [],
      agentConfigs: {
        opencode: { theme: "dark", permission: { bash: "ask" } },
      },
      opencode: {
        config: {
          permission: { edit: "allow", bash: "allow", webfetch: "allow" },
        },
      },
    });

    const configFile = provisioned.files.find(
      (file) => file.path === "~/.config/opencode/opencode.json",
    );
    const config = JSON.parse(Buffer.from(configFile!.contentBase64, "base64").toString());
    expect(config.permission).toEqual({
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
    });
    expect(config.username).toBe("Gitterm: User");
  });
});
