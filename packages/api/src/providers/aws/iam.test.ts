import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient } from "@aws-sdk/client-sts";
import {
  buildRoleDiscoveryPolicy,
  inspectAwsTaskRole,
  prepareAwsTaskRole,
  trustsEcsTasks,
  ROLE_DISCOVERY_ACTIONS,
  POLICY_DISCOVERY_ACTIONS,
} from "./iam";

const roleArn = "arn:aws:iam::123456789012:role/team/gitterm-task-workspace";
const config = { accessKeyId: "test", secretAccessKey: "test", defaultRegion: "eu-central-1" };
const trust = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "ecs-tasks.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
};
let calls: any[];
beforeEach(() => {
  calls = [];
  spyOn(STSClient.prototype, "send").mockImplementation(async () => ({ Account: "123456789012" }));
  spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
    calls.push(command);
    switch (command.constructor.name) {
      case "GetRoleCommand":
        return {
          Role: {
            Arn: roleArn,
            AssumeRolePolicyDocument: encodeURIComponent(JSON.stringify(trust)),
          },
        };
      case "CreateRoleCommand":
        return { Role: { Arn: roleArn } };
      case "PutRolePolicyCommand":
        return {};
      case "SimulatePrincipalPolicyCommand":
        return {
          EvaluationResults: command.input.ActionNames.map((EvalActionName: string) => ({
            EvalActionName,
            EvalDecision: "allowed",
          })),
        };
      default:
        throw new Error(`Unexpected IAM command ${command.constructor.name}`);
    }
  });
});
afterEach(() => mock.restore());

describe("AWS task-role capability discovery", () => {
  test("the baseline grants only six IAM reads, own-role access, and same-account/AWS policy documents", () => {
    const policy = buildRoleDiscoveryPolicy(roleArn);
    expect(policy.Statement[0]?.Resource).toBe(roleArn);
    expect(policy.Statement[0]?.Action).toEqual(ROLE_DISCOVERY_ACTIONS);
    expect(policy.Statement[1]?.Action).toEqual(POLICY_DISCOVERY_ACTIONS);
    expect(policy.Statement[1]?.Resource).toEqual([
      "arn:aws:iam::123456789012:policy/*",
      "arn:aws:iam::aws:policy/*",
    ]);
    expect(JSON.stringify(policy)).not.toContain("sts:AssumeRole");
    expect(JSON.stringify(policy)).not.toContain("iam:PutRolePolicy");
    expect(JSON.stringify(policy)).not.toContain("s3:");
  });

  test("accepts URL-encoded ECS trust and array forms; rejects unrelated or deny-only trust", () => {
    expect(trustsEcsTasks(encodeURIComponent(JSON.stringify(trust)))).toBe(true);
    expect(
      trustsEcsTasks(
        JSON.stringify({
          Statement: {
            Effect: "Allow",
            Action: ["sts:AssumeRole"],
            Principal: { Service: ["ecs-tasks.amazonaws.com"] },
          },
        }),
      ),
    ).toBe(true);
    expect(
      trustsEcsTasks(JSON.stringify({ Statement: [{ ...trust.Statement[0], Effect: "Deny" }] })),
    ).toBe(false);
    expect(
      trustsEcsTasks(
        JSON.stringify({
          Statement: [{ ...trust.Statement[0], Principal: { Service: "lambda.amazonaws.com" } }],
        }),
      ),
    ).toBe(false);
  });

  test("import checks identity, path, trust and discovery without modifying the role", async () => {
    const result = await prepareAwsTaskRole(config, { mode: "existing", arn: roleArn });
    expect(result.discovery).toBe("available");
    expect(result.warnings.join(" ")).toContain("not proof of effective access");
    expect(calls[0].input.RoleName).toBe("gitterm-task-workspace");
    expect(calls.map((command) => command.constructor.name)).toEqual([
      "GetRoleCommand",
      "SimulatePrincipalPolicyCommand",
      "SimulatePrincipalPolicyCommand",
    ]);
    expect(calls[1].input.PolicySourceArn).toBe(roleArn);
    expect(calls[1].input.ResourceArns).toEqual([roleArn]);
  });

  test("rejects another account before querying or changing IAM", async () => {
    await expect(
      inspectAwsTaskRole(config, roleArn.replace("123456789012", "999999999999")),
    ).rejects.toThrow("provider's AWS account");
    expect(calls).toHaveLength(0);
  });

  test("rejects an ARN with the wrong path", async () => {
    await expect(inspectAwsTaskRole(config, roleArn.replace("team/", "wrong/"))).rejects.toThrow(
      "different role ARN",
    );
    expect(calls).toHaveLength(1);
  });

  test("blocks incompatible ECS trust before simulation", async () => {
    const send = spyOn(IAMClient.prototype, "send").mockImplementation(async () => ({
      Role: { Arn: roleArn, AssumeRolePolicyDocument: JSON.stringify({ Statement: [] }) },
    }));
    await expect(inspectAwsTaskRole(config, roleArn)).rejects.toThrow(
      "explicitly trust ecs-tasks.amazonaws.com",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("reports missing discovery without granting it or blocking import", async () => {
    const original = (IAMClient.prototype.send as any).getMockImplementation();
    spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
      if (command.constructor.name !== "SimulatePrincipalPolicyCommand") return original(command);
      return {
        EvaluationResults: command.input.ActionNames.map((EvalActionName: string) => ({
          EvalActionName,
          EvalDecision: EvalActionName === "iam:GetPolicyVersion" ? "implicitDeny" : "allowed",
        })),
      };
    });
    const result = await prepareAwsTaskRole(config, { mode: "existing", arn: roleArn });
    expect(result.discovery).toBe("missing");
    expect(result.missingActions).toEqual(["iam:GetPolicyVersion"]);
    expect(calls.some((command) => command.constructor.name === "PutRolePolicyCommand")).toBe(
      false,
    );
  });

  test("missing context is not reported as available", async () => {
    const original = (IAMClient.prototype.send as any).getMockImplementation();
    spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
      if (command.constructor.name !== "SimulatePrincipalPolicyCommand") return original(command);
      return {
        EvaluationResults: command.input.ActionNames.map((EvalActionName: string) => ({
          EvalActionName,
          EvalDecision: "allowed",
          MissingContextValues: ["aws:PrincipalTag/Team"],
        })),
      };
    });
    expect((await inspectAwsTaskRole(config, roleArn)).discovery).toBe("missing");
  });

  test("simulation failure is unverified, not a false denial", async () => {
    const original = (IAMClient.prototype.send as any).getMockImplementation();
    spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
      if (command.constructor.name !== "SimulatePrincipalPolicyCommand") return original(command);
      throw new Error("AccessDenied");
    });
    const result = await inspectAwsTaskRole(config, roleArn);
    expect(result.discovery).toBe("unverified");
    expect(result.missingActions).toEqual([]);
    expect(result.warnings.join(" ")).toContain("iam:SimulatePrincipalPolicy");
  });

  test("creation adds only trust and discovery; never reuses an existing name", async () => {
    const result = await prepareAwsTaskRole(config, {
      mode: "create",
      name: "gitterm-task-workspace",
    });
    expect(calls.map((command) => command.constructor.name)).toEqual([
      "CreateRoleCommand",
      "PutRolePolicyCommand",
    ]);
    expect(JSON.parse(calls[0].input.AssumeRolePolicyDocument)).toEqual(trust);
    expect(JSON.parse(calls[1].input.PolicyDocument)).toEqual(buildRoleDiscoveryPolicy(roleArn));
    expect(result.discovery).toBe("unverified");
    spyOn(IAMClient.prototype, "send").mockImplementation(async () => {
      throw new Error("EntityAlreadyExists");
    });
    await expect(
      prepareAwsTaskRole(config, { mode: "create", name: "gitterm-task-workspace" }),
    ).rejects.toThrow("EntityAlreadyExists");
  });

  test("partial creation errors tell the admin how to recover without deleting a role", async () => {
    spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
      if (command.constructor.name === "CreateRoleCommand") return { Role: { Arn: roleArn } };
      throw new Error("AccessDenied");
    });
    await expect(
      prepareAwsTaskRole(config, { mode: "create", name: "gitterm-task-workspace" }),
    ).rejects.toThrow(`Role ${roleArn} was created`);
  });
});
