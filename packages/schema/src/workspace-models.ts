import z from "zod";

export const modelCredentialSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("saved"), label: z.string().trim().min(1).max(100) }).strict(),
  z.object({ source: z.literal("default") }).strict(),
  z.object({ source: z.literal("apiKey"), apiKey: z.string().trim().min(1).max(10_000) }).strict(),
]);

export const workspaceModelsSchema = z
  .object({
    default: z
      .string()
      .trim()
      .regex(/^[^/]+\/.+$/, "Model must use provider/model format")
      .max(255)
      .optional(),
    inherit: z.enum(["defaults", "none"]).default("none"),
    providers: z
      .record(
        z
          .string()
          .min(1)
          .max(100)
          .refine((key) => key === key.trim(), "Provider keys cannot have surrounding whitespace"),
        modelCredentialSourceSchema,
      )
      .refine(
        (providers) => Object.keys(providers).length <= 20,
        "At most 20 providers are allowed",
      )
      .optional(),
  })
  .strict();

export type WorkspaceModelsInput = z.input<typeof workspaceModelsSchema>;
