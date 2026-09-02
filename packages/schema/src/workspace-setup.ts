import { z } from "zod";

export const workspaceSetupCommandsSchema = z
  .array(z.string().trim().min(1).max(4_000))
  .max(10)
  .refine((commands) => commands.reduce((size, command) => size + command.length, 0) <= 16_000, {
    message: "Setup commands cannot exceed 16,000 characters in total",
  })
  .default([]);

export type WorkspaceSetupCommands = z.infer<typeof workspaceSetupCommandsSchema>;

export const workspaceSetupSchema = z
  .object({
    beforeAgent: workspaceSetupCommandsSchema.optional(),
    afterAgent: workspaceSetupCommandsSchema.optional(),
  })
  .strict()
  .refine(
    (setup) =>
      [...(setup.beforeAgent ?? []), ...(setup.afterAgent ?? [])].reduce(
        (size, command) => size + command.length,
        0,
      ) <= 16_000,
    { message: "Setup commands cannot exceed 16,000 characters in total" },
  );

export const workspaceSecretFileSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9._/-]+$/, "Secret file paths contain unsupported characters")
      .refine((path) => !path.startsWith("/") && !path.startsWith("~"), {
        message: "Secret file paths must be relative to the repository",
      })
      .refine(
        (path) =>
          !path.includes("\\") &&
          path
            .split("/")
            .every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
          !path.startsWith(".git/") &&
          path !== ".git" &&
          !path.startsWith(".gitterm/") &&
          path !== ".gitterm",
        { message: "Secret file path is not allowed" },
      ),
    content: z.string().max(64 * 1024),
    mode: z.enum(["0400", "0600"]).default("0600"),
  })
  .strict();

export const workspaceSecretFilesSchema = z
  .array(workspaceSecretFileSchema)
  .max(20)
  .refine((files) => new Set(files.map((file) => file.path)).size === files.length, {
    message: "Secret file paths must be unique",
  })
  .refine(
    (files) =>
      files.reduce((size, file) => size + new TextEncoder().encode(file.content).byteLength, 0) <=
      256 * 1024,
    { message: "Secret files cannot exceed 256 KiB in total" },
  );

export type WorkspaceSetup = z.infer<typeof workspaceSetupSchema>;
export type WorkspaceSecretFile = z.infer<typeof workspaceSecretFileSchema>;
