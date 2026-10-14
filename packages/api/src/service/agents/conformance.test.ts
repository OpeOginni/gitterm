import { expect, test } from "bun:test";
import { AGENT_PROVISIONER_KEYS } from "@gitterm/schema/workspace-catalog";
import { AGENT_CAPABILITIES } from "@gitterm/schema/agent-capabilities";
import { getAgentProvisioner } from ".";

for (const key of AGENT_PROVISIONER_KEYS) {
  test(`${key} conforms to the standard agent contract`, () => {
    const agent = getAgentProvisioner(key);
    expect(agent.key).toBe(key);
    expect(agent.capabilities).toEqual(AGENT_CAPABILITIES[key]);
    const payload = agent.provision({
      userId: "user",
      userDisplayName: "User",
      workspaceHostname: "workspace.gitterm.dev",
      agentTypeName: "Custom display name",
      serverOnly: true,
      serverPassword: "server-password",
      credentials: [],
    });
    expect(payload.serve?.port).toBe(4096);
    expect(payload.serve?.command).toBeString();
    expect(payload.usesServerPassword).toBe(agent.capabilities.access === "server-password");
    expect(payload.serve?.accessCredentialCommand).toBe(agent.accessCredentialCommand);
    expect(new Set(payload.files.map((file) => file.path)).size).toBe(payload.files.length);
    if (agent.capabilities.access === "pairing") {
      expect(agent.accessCredentialCommand).toBeString();
      expect(payload.env.OPENCODE_SERVER_PASSWORD).toBeUndefined();
    }
  });
}

test("unknown agent keys fail closed, including object prototype keys", () => {
  for (const key of ["missing", "toString", "__proto__"]) {
    expect(() => getAgentProvisioner(key)).toThrow("Unsupported agent provisioner");
  }
});
