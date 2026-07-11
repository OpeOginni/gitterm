import z from "zod";
import type { JSONSchema } from "zod/v4/core";
import opencodeConfigSchemaJson from "./opencode-config.json";

let cachedOpenCodeSchema: z.ZodType | null = null;

function getOpenCodeSchema(): z.ZodType {
  if (!cachedOpenCodeSchema) {
    cachedOpenCodeSchema = z.fromJSONSchema(opencodeConfigSchemaJson as JSONSchema.BaseSchema);
  }
  return cachedOpenCodeSchema;
}

export function validateOpenCodeConfig(config: unknown) {
  return getOpenCodeSchema().safeParse(config);
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
    description: "Applied to OpenCode and T3Code workspaces as opencode.json.",
    appliesTo: ["opencode", "t3code"],
    icon: "/opencode.svg",
    docsUrl: "https://opencode.ai/docs/config/",
    testHint: "opencode.json",
    example: {
      $schema: "https://opencode.ai/config.json",
      theme: "opencode",
      model: "opencode/big-pickle",
      autoupdate: true,
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
  return agentTypeName.trim().toLowerCase().startsWith("t3code");
}

export function configKindsForAgentType(agentTypeName: string): AgentConfigKind[] {
  const normalized = agentTypeName.trim().toLowerCase();
  return AGENT_CONFIG_KINDS.filter((kind) =>
    AGENT_CONFIG_KIND_META[kind].appliesTo.some((prefix) => normalized.startsWith(prefix)),
  );
}

export function validateAgentConfig(
  kind: AgentConfigKind | string,
  config: unknown,
): ReturnType<typeof validateOpenCodeConfig> | ReturnType<typeof validateJsonObjectConfig> {
  const validator = agentValidators[kind as AgentConfigKind] ?? validateJsonObjectConfig;
  return validator(config);
}
