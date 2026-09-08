import { describe, expect, it } from "bun:test";
import { buildAwsDeploymentPolicy } from "./deployment-policy";

describe("AWS deployment policy", () => {
  it("does not grant writes or deletion on imported workspace roles", () => {
    const arn = "arn:aws:iam::123456789012:role/gitterm-task-development";
    const imported = buildAwsDeploymentPolicy("123456789012", "eu-central-1", arn, "existing");
    const role = imported.Statement.find((item) => item.Sid === "GitTermWorkspaceRole")!;
    expect(role.Resource).toBe(arn);
    expect(role.Action).not.toContain("iam:PutRolePolicy");
    expect(role.Action).not.toContain("iam:CreateRole");
    expect(role.Action).not.toContain("iam:DeleteRole");
    expect(
      imported.Statement.find((item) => item.Sid === "GitTermRoleManagement")?.Resource,
    ).not.toBe(arn);
  });
  const account = "123456789012";
  const region = "eu-central-1";
  const policy = buildAwsDeploymentPolicy(account, region);
  const statement = (sid: string) => policy.Statement.find((item) => item.Sid === sid)!;

  it("scopes regional services and the stack to the selected region", () => {
    for (const sid of [
      "GitTermCloudFormation",
      "GitTermDiscovery",
      "GitTermSetupResources",
      "GitTermWorkspaceLifecycle",
    ]) {
      expect(statement(sid).Condition).toEqual({ StringEquals: { "aws:RequestedRegion": region } });
    }
    expect(statement("GitTermCloudFormation").Resource).toBe(
      `arn:aws:cloudformation:${region}:${account}:stack/gitterm-${region}/*`,
    );
    expect(JSON.stringify(policy)).not.toContain("<ACCOUNT_ID>");
  });

  it("keeps IAM global and PassRole limited to ECS tasks and exact roles", () => {
    expect(statement("GitTermRoleManagement").Condition).toBeUndefined();
    expect(statement("GitTermPassRole").Resource).toEqual([
      `arn:aws:iam::${account}:role/gitterm-task-execution-${region}`,
      `arn:aws:iam::${account}:role/gitterm-task-${region}`,
    ]);
    expect(statement("GitTermPassRole").Condition).toEqual({
      StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
    });
  });

  it("uses the selected custom role, including its IAM path", () => {
    const arn = `arn:aws:iam::${account}:role/team/gitterm-task-development`;
    const custom = buildAwsDeploymentPolicy(account, region, arn);
    for (const sid of ["GitTermWorkspaceRole", "GitTermPassRole"]) {
      expect(custom.Statement.find((item) => item.Sid === sid)?.Resource).toContain(arn);
    }
  });

  it("scopes managed-policy reads to policies rather than roles", () => {
    expect(statement("GitTermReadManagedPolicies").Resource).toEqual([
      `arn:aws:iam::${account}:policy/*`,
      "arn:aws:iam::aws:policy/*",
    ]);
    expect(statement("GitTermRoleManagement").Action).not.toContain("iam:GetPolicy");
  });

  it("restricts policy attachment and service-linked role creation", () => {
    expect(statement("GitTermExecutionRolePolicy").Condition).toEqual({
      ArnEquals: {
        "iam:PolicyARN": "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
      },
    });
    expect(
      statement("GitTermServiceLinkedRoles").Condition?.StringEquals?.["iam:AWSServiceName"],
    ).toEqual([
      "ecs.amazonaws.com",
      "elasticloadbalancing.amazonaws.com",
      "elasticfilesystem.amazonaws.com",
    ]);
    expect(statement("GitTermRoleManagement").Action).toContain("iam:SimulatePrincipalPolicy");
    expect(statement("GitTermRoleManagement").Action).not.toContain("iam:AttachRolePolicy");
  });
});
