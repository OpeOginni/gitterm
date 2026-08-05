import { z } from "zod";

export const workspaceSetupCommandsSchema = z
  .array(z.string().trim().min(1).max(4_000))
  .max(10)
  .refine((commands) => commands.reduce((size, command) => size + command.length, 0) <= 16_000, {
    message: "Setup commands cannot exceed 16,000 characters in total",
  })
  .default([]);

export type WorkspaceSetupCommands = z.infer<typeof workspaceSetupCommandsSchema>;
