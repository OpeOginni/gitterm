import { z } from "zod";

export const PROVIDER_KEYS = [
  "railway",
  "aws",
  "e2b",
  "daytona",
  "cloudflare",
  "vercel",
  "upstash",
  "ascii",
  "exedev",
] as const;

export const providerKeySchema = z.enum(PROVIDER_KEYS);
export type ProviderKey = z.infer<typeof providerKeySchema>;

export const AGENT_PROVISIONER_KEYS = ["opencode", "t3code"] as const;
export const agentProvisionerKeySchema = z.enum(AGENT_PROVISIONER_KEYS);
export type AgentProvisionerKey = z.infer<typeof agentProvisionerKeySchema>;

export const BUILT_IN_AGENT_KEYS = ["opencode-ttyd", "opencode", "t3code"] as const;
export type BuiltInAgentKey = (typeof BUILT_IN_AGENT_KEYS)[number];

const positiveResourceSchema = z.number().positive();

export const providerMachineOptionsSchemas = {
  railway: z.object({}).strict(),
  aws: z
    .object({
      cpu: z.number().int().positive().optional(),
      memory: z.number().int().positive().optional(),
      ephemeralStorageGiB: z.number().int().min(20).max(200).optional(),
      architecture: z.enum(["X86_64", "ARM64"]).optional(),
    })
    .strict(),
  e2b: z
    .object({
      templateId: z.string().trim().min(1).optional(),
      sshTemplateId: z.string().trim().min(1).optional(),
    })
    .strict(),
  daytona: z
    .object({
      resources: z
        .object({
          cpu: positiveResourceSchema.optional(),
          memory: positiveResourceSchema.optional(),
          disk: positiveResourceSchema.optional(),
        })
        .strict()
        .optional(),
      editorResources: z
        .object({
          cpu: positiveResourceSchema.optional(),
          memory: positiveResourceSchema.optional(),
          disk: positiveResourceSchema.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  cloudflare: z.object({}).strict(),
  vercel: z.object({ vcpus: positiveResourceSchema.optional() }).strict(),
  upstash: z.object({ size: z.enum(["small", "medium", "large"]).optional() }).strict(),
  ascii: z.object({ size: z.enum(["small", "default", "large"]).optional() }).strict(),
  exedev: z
    .object({
      cpu: positiveResourceSchema.optional(),
      memory: z.string().trim().min(1).optional(),
      disk: z.string().trim().min(1).optional(),
    })
    .strict(),
} satisfies Record<ProviderKey, z.ZodType<Record<string, unknown>>>;

export type ProviderMachineOptions = {
  [K in ProviderKey]: z.infer<(typeof providerMachineOptionsSchemas)[K]>;
};

export function parseProviderMachineOptions<K extends ProviderKey>(
  providerKey: K,
  value: unknown,
): ProviderMachineOptions[K] {
  return providerMachineOptionsSchemas[providerKey].parse(value) as ProviderMachineOptions[K];
}

const providerSelectionBase = {
  providerId: z.uuid().optional(),
  machine: z
    .union([
      z.object({ type: z.literal("profile"), key: z.string().trim().min(1) }).strict(),
      z
        .object({ type: z.literal("custom"), resources: z.record(z.string(), z.unknown()) })
        .strict(),
    ])
    .optional(),
};

export const workspaceProviderSelectionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("railway"),
      ...providerSelectionBase,
      region: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("aws"),
      ...providerSelectionBase,
      region: z.string().min(1).optional(),
    })
    .strict(),
  ...(["e2b", "daytona", "cloudflare", "vercel", "upstash", "ascii", "exedev"] as const).map(
    (type) => z.object({ type: z.literal(type), ...providerSelectionBase }).strict(),
  ),
]);

export type WorkspaceProviderSelection = z.infer<typeof workspaceProviderSelectionSchema>;
