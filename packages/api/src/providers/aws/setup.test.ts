import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { EC2Client } from "@aws-sdk/client-ec2";
import { IAMClient } from "@aws-sdk/client-iam";
import { STSClient } from "@aws-sdk/client-sts";
import { bootstrapAwsProvider, deleteAwsProviderInfrastructure } from "./setup";
import { resolveAwsTaskRoleName } from "./task-role";

const input = { accessKeyId: "test", secretAccessKey: "test", defaultRegion: "eu-central-1" };
const roleArn = "arn:aws:iam::123456789012:role/demo/gitterm-task-presentation";
const outputs = {
  ClusterArn: "cluster",
  AlbDnsName: "alb.example.com",
  AlbListenerArn: "listener",
  WorkspaceSecurityGroupId: "sg-workspace",
  TaskExecutionRoleArn: "execution-role",
  TaskRoleArn: roleArn,
  LogGroupName: "/gitterm/workspaces",
  EfsFileSystemId: "fs-workspaces",
};
const complete = {
  Stacks: [
    {
      StackStatus: "UPDATE_COMPLETE",
      Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
        OutputKey,
        OutputValue,
      })),
    },
  ],
};
function awsError(name: string, message = name) {
  return Object.assign(new Error(message), { name });
}

beforeEach(() => {
  spyOn(STSClient.prototype, "send").mockImplementation(
    async () => ({ Account: "123456789012" }) as any,
  );
  spyOn(EC2Client.prototype, "send").mockImplementation(async (command: any) => {
    if (command.constructor.name === "DescribeVpcsCommand")
      return { Vpcs: [{ VpcId: "vpc-default" }] };
    if (command.constructor.name === "DescribeSubnetsCommand")
      return {
        Subnets: ["a", "b"].map((az) => ({
          SubnetId: `subnet-${az}`,
          State: "available",
          AvailabilityZone: az,
          MapPublicIpOnLaunch: true,
        })),
      };
    throw new Error(`Unexpected EC2 command ${command.constructor.name}`);
  });
  spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
    if (
      command.constructor.name === "GetRoleCommand" ||
      command.constructor.name === "CreateRoleCommand"
    )
      return { Role: { Arn: roleArn } };
    if (command.constructor.name === "PutRolePolicyCommand") return {};
    throw new Error(`Unexpected IAM command ${command.constructor.name}`);
  });
  spyOn(CloudFormationClient.prototype, "send").mockImplementation(async (command: any) => {
    if (command.constructor.name === "DescribeStacksCommand") return complete;
    if (command.constructor.name === "UpdateStackCommand") return {};
    throw new Error(`Unexpected CloudFormation command ${command.constructor.name}`);
  });
});
afterEach(() => mock.restore());

describe("AWS setup", () => {
  test("validates names without silently renaming a custom role", () => {
    expect(resolveAwsTaskRoleName(input.defaultRegion)).toBe("gitterm-task-eu-central-1");
    expect(resolveAwsTaskRoleName(input.defaultRegion, "  gitterm-task-Demo+=,.@_-123  ")).toBe(
      "gitterm-task-Demo+=,.@_-123",
    );
    for (const invalid of [roleArn, "path/role", "spaces inside", "x".repeat(65)]) {
      expect(() => resolveAwsTaskRoleName(input.defaultRegion, invalid)).toThrow();
    }
  });

  test("reuses a custom role and passes its actual ARN through CloudFormation and config", async () => {
    const result = await bootstrapAwsProvider({
      ...input,
      taskRoleName: " gitterm-task-presentation ",
    });
    expect(result.config.taskRoleArn).toBe(roleArn);
    const iamCalls = (IAMClient.prototype.send as any).mock.calls.map(
      ([command]: any[]) => command,
    );
    expect(iamCalls[0].input.RoleName).toBe("gitterm-task-presentation");
    expect(iamCalls.some((command: any) => command.constructor.name === "CreateRoleCommand")).toBe(
      false,
    );
    expect(
      iamCalls.some((command: any) => command.constructor.name === "PutRolePolicyCommand"),
    ).toBe(false);
    const update = (CloudFormationClient.prototype.send as any).mock.calls
      .map(([command]: any[]) => command)
      .find((command: any) => command.constructor.name === "UpdateStackCommand");
    expect(update.input.Parameters).toContainEqual({
      ParameterKey: "ExistingTaskRoleArn",
      ParameterValue: roleArn,
    });
    expect(result.config.albBaseUrl).toBe("http://alb.example.com");
  });

  test.each(["NoSuchEntity", "NoSuchEntityException"])(
    "creates a role when IAM returns %s",
    async (name) => {
      spyOn(IAMClient.prototype, "send").mockImplementation(async (command: any) => {
        if (command.constructor.name === "GetRoleCommand") throw awsError(name);
        if (command.constructor.name === "CreateRoleCommand") {
          expect(command.input.RoleName).toBe("gitterm-task-demo");
          expect(
            JSON.parse(command.input.AssumeRolePolicyDocument).Statement[0].Principal.Service,
          ).toBe("ecs-tasks.amazonaws.com");
          return { Role: { Arn: roleArn } };
        }
        return {};
      });
      await bootstrapAwsProvider({ ...input, taskRoleName: "gitterm-task-demo" });
    },
  );

  test("does not turn IAM access denial into role creation", async () => {
    const send = spyOn(IAMClient.prototype, "send").mockImplementation(async () => {
      throw awsError("AccessDenied");
    });
    await expect(bootstrapAwsProvider(input)).rejects.toThrow("AccessDenied");
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("does not report deletion success on a CloudFormation permission error", async () => {
    const send = spyOn(CloudFormationClient.prototype, "send").mockImplementation(async () => {
      throw awsError("AccessDenied");
    });
    await expect(deleteAwsProviderInfrastructure(input)).rejects.toThrow("AccessDenied");
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("does not try creating a stack after a failed lookup", async () => {
    const send = spyOn(CloudFormationClient.prototype, "send").mockImplementation(async () => {
      throw awsError("ExpiredToken");
    });
    await expect(bootstrapAwsProvider(input)).rejects.toThrow("ExpiredToken");
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("deleting an absent stack is idempotent", async () => {
    spyOn(CloudFormationClient.prototype, "send").mockImplementation(async () => {
      throw awsError("ValidationError", "Stack with id gitterm-eu-central-1 does not exist");
    });
    expect(await deleteAwsProviderInfrastructure(input)).toEqual({
      deleted: false,
      stackName: "gitterm-eu-central-1",
    });
  });

  test("permission errors during deletion polling do not report success", async () => {
    const send = spyOn(CloudFormationClient.prototype, "send")
      .mockImplementationOnce(async () => complete)
      .mockImplementationOnce(async () => ({}))
      .mockImplementationOnce(async () => {
        throw awsError("AccessDenied");
      });
    await expect(deleteAwsProviderInfrastructure(input)).rejects.toThrow("AccessDenied");
    expect(send.mock.calls[1]![0].constructor.name).toBe("DeleteStackCommand");
  });
});
