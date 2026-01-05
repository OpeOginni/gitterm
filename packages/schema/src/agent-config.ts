import z from "zod";
import type { JSONSchema } from "zod/v4/core";
import opencodeConfigSchemaJson from "./opencode-config.json";

// Cache the compiled schema to avoid recreating it on every validation
let cachedOpenCodeSchema: z.ZodType | null = null;

function getOpenCodeSchema(): z.ZodType {
  if (!cachedOpenCodeSchema) {
    cachedOpenCodeSchema = z.fromJSONSchema(opencodeConfigSchemaJson as JSONSchema.BaseSchema);
  }
  return cachedOpenCodeSchema;
}

// OpenCode Config Validator using SDK type
export function validateOpenCodeConfig(config: unknown) {
  const schema = getOpenCodeSchema();
  return schema.safeParse(config);
}

// Validator registry for dynamic access
export const agentValidators = {
  opencode: validateOpenCodeConfig,
  "opencode web": validateOpenCodeConfig,
  "opencode cli": validateOpenCodeConfig,
  "opencode server": validateOpenCodeConfig,
  "shuvcode": validateOpenCodeConfig,
  "shuvcode server": validateOpenCodeConfig,
  // Add more agent validators here:
  // "claude-code": validateClaudeCodeConfig,
  // "codex": validateCodexConfig,
} as const;

/**
 * Validate config for an agent type
 * Routes to the appropriate validator based on agent type
 * @param agentTypeName - The agent type identifier
 * @param config - The configuration object to validate
 * @returns Validation result with type information preserved
 */
export function validateAgentConfig(
  agentTypeName: string,
  config: unknown
): ReturnType<typeof validateOpenCodeConfig> {
  const validatorKey = agentTypeName.toLowerCase() as keyof typeof agentValidators;
  const validator = agentValidators[validatorKey] || validateOpenCodeConfig;
  return validator(config);
}
