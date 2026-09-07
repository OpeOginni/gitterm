import { expect, test } from "bun:test";
import { awsRoleSelectionSchema } from "./aws-access";

test("workspace roles require their namespace and reject execution roles", () => {
  for (const name of ["gitterm-task-development", "gitterm-task-data-readonly"]) {
    expect(awsRoleSelectionSchema.safeParse({ mode: "create", name }).success).toBe(true);
    expect(
      awsRoleSelectionSchema.safeParse({
        mode: "existing",
        arn: `arn:aws:iam::123456789012:role/team/${name}`,
      }).success,
    ).toBe(true);
  }
  for (const name of [
    "Admin",
    "gitterm-task-",
    "gitterm-task-execution-eu-central-1",
    "gitterm-execution-eu-central-1",
  ]) {
    expect(awsRoleSelectionSchema.safeParse({ mode: "create", name }).success).toBe(false);
    expect(
      awsRoleSelectionSchema.safeParse({
        mode: "existing",
        arn: `arn:aws:iam::123456789012:role/${name}`,
      }).success,
    ).toBe(false);
  }
});
