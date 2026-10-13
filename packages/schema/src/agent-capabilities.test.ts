import { expect, test } from "bun:test";
import { agentProvisionerKeyForName, getAgentCapabilities } from "./agent-capabilities";
import { configKindsForAgentType } from "./agent-config";

test("legacy names resolve consistently, unknown agents are not assumed to be OpenCode", () => {
  expect(agentProvisionerKeyForName(" T3Code Server ")).toBe("t3code");
  expect(agentProvisionerKeyForName("OpenCode (TTYD)")).toBe("opencode");
  expect(agentProvisionerKeyForName("unknown")).toBeUndefined();
  expect(getAgentCapabilities("__proto__")).toBeUndefined();
});

test("configuration availability follows the same agent capability registry", () => {
  expect(configKindsForAgentType("T3Code")).toEqual(["opencode", "claude-code", "codex"]);
  expect(configKindsForAgentType("OpenCode Server")).toEqual(["opencode"]);
  expect(configKindsForAgentType("unknown")).toEqual([]);
  expect(configKindsForAgentType("Custom Agent Name", "t3code")).toEqual([
    "opencode",
    "claude-code",
    "codex",
  ]);
});
