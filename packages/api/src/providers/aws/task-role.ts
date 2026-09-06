import { z } from "zod";

export const awsTaskRoleNameSchema = z
  .string()
  .trim()
  .max(64, "IAM role names must be 64 characters or fewer")
  .regex(/^[\w+=,.@-]*$/, "Use an IAM role name, not an ARN or path (letters, numbers, _+=,.@-)");

export function resolveAwsTaskRoleName(region: string, name?: string): string {
  return (
    awsTaskRoleNameSchema.parse(name ?? "") || `gitterm-task-${region.replace(/[^a-z0-9-]/gi, "-")}`
  );
}
