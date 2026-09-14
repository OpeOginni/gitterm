import { describe, expect, it } from "bun:test";
import {
  buildRoleDiscoveryPolicy,
  buildTaskRolePolicy,
  POLICY_DISCOVERY_ACTIONS,
  ROLE_DISCOVERY_ACTIONS,
} from "./task-role-policy";

const roleArn = "arn:aws:iam::123456789012:role/team/gitterm-task-workspace";

describe("task role policy", () => {
  it("is the discovery baseline when no add-ons are selected", () => {
    expect(buildTaskRolePolicy(roleArn)).toEqual(buildRoleDiscoveryPolicy(roleArn));
    const [role, policies] = buildTaskRolePolicy(roleArn).Statement;
    expect(role).toEqual({ Effect: "Allow", Action: ROLE_DISCOVERY_ACTIONS, Resource: roleArn });
    expect(policies?.Action).toEqual(POLICY_DISCOVERY_ACTIONS);
    expect(policies?.Resource).toEqual([
      "arn:aws:iam::123456789012:policy/*",
      "arn:aws:iam::aws:policy/*",
    ]);
  });

  it("appends Bedrock statements scoped to the role's partition and account", () => {
    const policy = buildTaskRolePolicy(roleArn, ["bedrock"]);
    expect(policy.Statement).toHaveLength(5);
    const invoke = policy.Statement.find((statement) => statement.Sid === "GitTermBedrockInvoke");
    expect(invoke?.Action).toContain("bedrock:InvokeModel");
    expect(invoke?.Resource).toEqual([
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:123456789012:inference-profile/*",
    ]);
    expect(
      policy.Statement.find((statement) => statement.Sid === "GitTermBedrockMantleInference"),
    ).toEqual({
      Sid: "GitTermBedrockMantleInference",
      Effect: "Allow",
      Action: "bedrock-mantle:CreateInference",
      Resource: "arn:aws:bedrock-mantle:*:123456789012:project/default",
    });
    expect(JSON.stringify(policy)).not.toContain("iam:PutRolePolicy");
  });

  it("keeps an account placeholder intact for roles that do not exist yet", () => {
    const placeholder = "arn:aws:iam::<ACCOUNT_ID>:role/gitterm-task-dev";
    const text = JSON.stringify(buildTaskRolePolicy(placeholder, ["bedrock"]));
    expect(text).toContain("arn:aws:iam::<ACCOUNT_ID>:policy/*");
    expect(text).toContain("arn:aws:bedrock:*:<ACCOUNT_ID>:inference-profile/*");
    expect(text).toContain("arn:aws:bedrock-mantle:*:<ACCOUNT_ID>:project/default");
  });
});
