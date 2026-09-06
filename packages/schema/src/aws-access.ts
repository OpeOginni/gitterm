import { z } from "zod";

export const awsTaskRoleArnSchema = z
  .string()
  .trim()
  .regex(/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/, "Enter an IAM role ARN from your AWS account");

export const awsAccessProfileSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  roleArn: awsTaskRoleArnSchema,
});
export type AwsAccessProfile = z.infer<typeof awsAccessProfileSchema>;

export const awsRoleSelectionSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("create"),
      name: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[\w+=,.@-]+$/),
    })
    .strict(),
  z.object({ mode: z.literal("existing"), arn: awsTaskRoleArnSchema }).strict(),
]);
