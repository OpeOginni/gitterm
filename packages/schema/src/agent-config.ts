import z from "zod";
import { Config } from "@opencode/schema/config";
import * as Schema from "effect/Schema";
import { isFailure } from "effect/Result";
import { agentProvisionerKeyForName, getAgentCapabilities } from "./agent-capabilities";

const decodeOpenCodeConfig = Schema.decodeUnknownResult(
  Schema.Struct({ ...Config.Info.fields, theme: Schema.optionalKey(Schema.String) }),
  { onExcessProperty: "error" },
);
const openCodeConfigSchema = z.record(z.string(), z.unknown()).superRefine((config, ctx) => {
  const result = decodeOpenCodeConfig(config);
  if (isFailure(result)) ctx.addIssue({ code: "custom", message: result.failure.message });
});

export function validateOpenCodeConfig(config: unknown) {
  return openCodeConfigSchema.safeParse(config);
}

const jsonObjectSchema = z.record(z.string(), z.unknown());

export function validateJsonObjectConfig(config: unknown) {
  return jsonObjectSchema.safeParse(config);
}

export const AGENT_CONFIG_KINDS = ["opencode", "claude-code", "codex"] as const;
export type AgentConfigKind = (typeof AGENT_CONFIG_KINDS)[number];

export const agentConfigKindSchema = z.enum(AGENT_CONFIG_KINDS);

export type AgentConfigKindMeta = {
  id: AgentConfigKind;
  label: string;
  description: string;
  appliesTo: readonly string[];
  icon: string;
  docsUrl?: string;
  testHint: string;
  example: Record<string, unknown>;
};

export const AGENT_CONFIG_KIND_META: Record<AgentConfigKind, AgentConfigKindMeta> = {
  opencode: {
    id: "opencode",
    label: "OpenCode",
    description: "OpenCode V2 settings and theme for OpenCode and T3Code workspaces.",
    appliesTo: ["opencode", "t3code"],
    icon: "/opencode.svg",
    docsUrl: "https://opencode.ai/v2/docs/config/",
    testHint: "opencode.json",
    example: {
      $schema: "https://opencode.ai/config.json",
      theme: "opencode",
      model: "opencode/deepseek-v4-pro",
      update: "notify",
    },
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    description: "Applied to T3Code workspaces as Claude Code settings.",
    appliesTo: ["t3code"],
    icon: "/claude.svg",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/settings",
    testHint: "~/.claude/settings.json",
    example: {
      permissions: {
        allow: ["Bash(git *)", "Read", "Edit"],
      },
    },
  },
  codex: {
    id: "codex",
    label: "Codex",
    description: "Applied to T3Code workspaces as Codex config.",
    appliesTo: ["t3code"],
    icon: "/openai-codex.svg",
    docsUrl: "https://github.com/openai/codex",
    testHint: "~/.codex/config.toml",
    example: {
      model: "gpt-5.1-codex",
      approval_policy: "on-request",
    },
  },
};

export const agentValidators: Record<
  AgentConfigKind,
  (
    config: unknown,
  ) => ReturnType<typeof validateOpenCodeConfig> | ReturnType<typeof validateJsonObjectConfig>
> = {
  opencode: validateOpenCodeConfig,
  "claude-code": validateJsonObjectConfig,
  codex: validateJsonObjectConfig,
};

export function isT3AgentType(agentTypeName: string): boolean {
  return agentProvisionerKeyForName(agentTypeName) === "t3code";
}

export function configKindsForAgentType(
  agentTypeName: string,
  provisionerKey?: string,
): AgentConfigKind[] {
  const key = provisionerKey ?? agentProvisionerKeyForName(agentTypeName);
  return key ? [...(getAgentCapabilities(key)?.configKinds ?? [])] : [];
}

export function validateAgentConfig(
  kind: AgentConfigKind | string,
  config: unknown,
): ReturnType<typeof validateOpenCodeConfig> | ReturnType<typeof validateJsonObjectConfig> {
  const validator = agentValidators[kind as AgentConfigKind] ?? validateJsonObjectConfig;
  return validator(config);
}
