import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { DescribeSubnetsCommand, DescribeVpcsCommand, EC2Client } from "@aws-sdk/client-ec2";
import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { AwsConfig } from "./types";

const STACK_NAME_PREFIX = "gitterm";
const STACK_POLL_INTERVAL_MS = 5000;
const STACK_TIMEOUT_MS = 10 * 60 * 1000;

export interface AwsBootstrapInput {
  accessKeyId: string;
  secretAccessKey: string;
  defaultRegion: string;
  publicSshEnabled?: boolean;
}

export interface AwsBootstrapSummary {
  accountId: string;
  region: string;
  stackName: string;
  vpcId: string;
  subnetIds: string[];
  albDnsName: string;
  albListenerArn: string;
  clusterArn: string;
  securityGroupIds: string[];
  taskExecutionRoleArn: string;
  taskRoleArn: string;
  logGroupName: string;
  efsFileSystemId: string;
}

export interface AwsBootstrapResult {
  config: AwsConfig;
  summary: AwsBootstrapSummary;
}

export interface AwsDeleteInfrastructureResult {
  deleted: boolean;
  stackName: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAwsNamePart(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-");
}

function buildStackName(region: string): string {
  return `${STACK_NAME_PREFIX}-${normalizeAwsNamePart(region)}`;
}

function buildTaskRoleName(region: string): string {
  return `gitterm-task-${normalizeAwsNamePart(region)}`;
}

function buildTemplate(subnetCount: number): string {
  const subnetParams: Record<string, object> = {};
  const subnetConditions: Record<string, object> = {};
  const mountTargets: Record<string, object> = {};

  for (let i = 1; i <= subnetCount; i++) {
    subnetParams[`Subnet${i}`] = {
      Type: "String",
      ...(i > 1 ? { Default: "" } : {}),
    };

    if (i > 1) {
      subnetConditions[`HasSubnet${i}`] = {
        "Fn::Not": [{ "Fn::Equals": [{ Ref: `Subnet${i}` }, ""] }],
      };
    }

    mountTargets[`EfsMountTarget${i}`] = {
      Type: "AWS::EFS::MountTarget",
      ...(i > 1 ? { Condition: `HasSubnet${i}` } : {}),
      Properties: {
        FileSystemId: { Ref: "EfsFileSystem" },
        SubnetId: { Ref: `Subnet${i}` },
        SecurityGroups: [{ Ref: "EfsSecurityGroup" }],
      },
    };
  }

  const subnetRefs = Array.from({ length: subnetCount }, (_, i) => ({
    Ref: `Subnet${i + 1}`,
  }));

  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "GitTerm shared infrastructure for AWS workspace provider",
    Parameters: {
      VpcId: { Type: "AWS::EC2::VPC::Id" },
      ExistingTaskRoleArn: { Type: "String", Default: "" },
      PublicSshEnabled: {
        Type: "String",
        AllowedValues: ["true", "false"],
        Default: "false",
      },
      ...subnetParams,
    },
    Conditions: {
      ...subnetConditions,
      EnablePublicSsh: { "Fn::Equals": [{ Ref: "PublicSshEnabled" }, "true"] },
    },
    Resources: {
      AlbSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        Properties: {
          GroupDescription: "GitTerm ALB security group",
          VpcId: { Ref: "VpcId" },
          SecurityGroupIngress: [
            {
              IpProtocol: "tcp",
              FromPort: 80,
              ToPort: 80,
              CidrIp: "0.0.0.0/0",
            },
            {
              IpProtocol: "tcp",
              FromPort: 80,
              ToPort: 80,
              CidrIpv6: "::/0",
            },
          ],
          Tags: [{ Key: "Name", Value: "gitterm-alb" }],
        },
      },

      WorkspaceSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        Properties: {
          GroupDescription: "GitTerm workspace security group",
          VpcId: { Ref: "VpcId" },
          Tags: [{ Key: "Name", Value: "gitterm-workspace" }],
        },
      },

      WorkspaceIngressFromAlb: {
        Type: "AWS::EC2::SecurityGroupIngress",
        Properties: {
          GroupId: { Ref: "WorkspaceSecurityGroup" },
          IpProtocol: "tcp",
          FromPort: 1,
          ToPort: 65535,
          SourceSecurityGroupId: { Ref: "AlbSecurityGroup" },
        },
      },

      WorkspaceSshIngress: {
        Type: "AWS::EC2::SecurityGroupIngress",
        Condition: "EnablePublicSsh",
        Properties: {
          GroupId: { Ref: "WorkspaceSecurityGroup" },
          IpProtocol: "tcp",
          FromPort: 22,
          ToPort: 22,
          CidrIp: "0.0.0.0/0",
          Description:
            "Public SSH access for GitTerm editor connections. Containers require key auth.",
        },
      },

      EfsSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        Properties: {
          GroupDescription: "GitTerm EFS security group",
          VpcId: { Ref: "VpcId" },
          Tags: [{ Key: "Name", Value: "gitterm-efs" }],
        },
      },

      EfsIngressFromWorkspace: {
        Type: "AWS::EC2::SecurityGroupIngress",
        Properties: {
          GroupId: { Ref: "EfsSecurityGroup" },
          IpProtocol: "tcp",
          FromPort: 2049,
          ToPort: 2049,
          SourceSecurityGroupId: { Ref: "WorkspaceSecurityGroup" },
        },
      },

      Cluster: {
        Type: "AWS::ECS::Cluster",
        Properties: {
          ClusterName: { "Fn::Sub": "gitterm-${AWS::Region}" },
        },
      },

      LoadBalancer: {
        Type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        Properties: {
          Name: { "Fn::Sub": "gitterm-${AWS::Region}" },
          Type: "application",
          Scheme: "internet-facing",
          Subnets: subnetRefs,
          SecurityGroups: [{ Ref: "AlbSecurityGroup" }],
          IpAddressType: "ipv4",
        },
      },

      Listener: {
        Type: "AWS::ElasticLoadBalancingV2::Listener",
        Properties: {
          LoadBalancerArn: { Ref: "LoadBalancer" },
          Port: 80,
          Protocol: "HTTP",
          DefaultActions: [
            {
              Type: "fixed-response",
              FixedResponseConfig: {
                ContentType: "text/plain",
                MessageBody: "GitTerm workspace route not found",
                StatusCode: "404",
              },
            },
          ],
        },
      },

      TaskExecutionRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: { "Fn::Sub": "gitterm-task-execution-${AWS::Region}" },
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "ecs-tasks.amazonaws.com" },
                Action: "sts:AssumeRole",
              },
            ],
          },
          ManagedPolicyArns: [
            "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
          ],
        },
      },

      LogGroup: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: "/gitterm/workspaces",
          RetentionInDays: 30,
        },
      },

      EfsFileSystem: {
        Type: "AWS::EFS::FileSystem",
        Properties: {
          Encrypted: true,
          PerformanceMode: "generalPurpose",
          ThroughputMode: "bursting",
          FileSystemTags: [{ Key: "Name", Value: "gitterm-workspaces" }],
        },
      },

      ...mountTargets,
    },

    Outputs: {
      ClusterArn: {
        Value: { "Fn::GetAtt": ["Cluster", "Arn"] },
      },
      AlbDnsName: {
        Value: { "Fn::GetAtt": ["LoadBalancer", "DNSName"] },
      },
      AlbListenerArn: {
        Value: { Ref: "Listener" },
      },
      WorkspaceSecurityGroupId: {
        Value: { Ref: "WorkspaceSecurityGroup" },
      },
      TaskExecutionRoleArn: {
        Value: { "Fn::GetAtt": ["TaskExecutionRole", "Arn"] },
      },
      TaskRoleArn: {
        Value: { Ref: "ExistingTaskRoleArn" },
      },
      LogGroupName: {
        Value: { Ref: "LogGroup" },
      },
      EfsFileSystemId: {
        Value: { Ref: "EfsFileSystem" },
      },
    },
  };

  return JSON.stringify(template);
}

async function findDefaultVpc(ec2: EC2Client): Promise<string> {
  const response = await ec2.send(
    new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }),
  );
  const vpcId = response.Vpcs?.[0]?.VpcId;

  if (!vpcId) {
    throw new Error("AWS simple setup requires a default VPC in the selected region.");
  }

  return vpcId;
}

async function findPublicSubnetIds(ec2: EC2Client, vpcId: string): Promise<string[]> {
  const response = await ec2.send(
    new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }] }),
  );

  const subnetsByAz = new Map<string, string>();
  for (const subnet of response.Subnets ?? []) {
    if (
      !subnet.SubnetId ||
      subnet.State !== "available" ||
      !subnet.AvailabilityZone ||
      !subnet.MapPublicIpOnLaunch
    ) {
      continue;
    }

    if (!subnetsByAz.has(subnet.AvailabilityZone)) {
      subnetsByAz.set(subnet.AvailabilityZone, subnet.SubnetId);
    }
  }

  const subnetIds = [...subnetsByAz.values()];
  if (subnetIds.length < 2) {
    throw new Error(
      "AWS simple setup requires at least two public subnets in different availability zones.",
    );
  }

  return subnetIds;
}

async function findExistingIamRoleArn(
  iam: IAMClient,
  roleName: string,
): Promise<string | undefined> {
  try {
    const response = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    return response.Role?.Arn;
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchEntityException") {
      return undefined;
    }
    throw error;
  }
}

async function ensureTaskRoleArn(iam: IAMClient, region: string): Promise<string> {
  const roleName = buildTaskRoleName(region);
  const existingArn = await findExistingIamRoleArn(iam, roleName);
  if (existingArn) {
    await ensureTaskRoleIntrospectionPolicy(iam, roleName);
    return existingArn;
  }

  const response = await iam.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      Tags: [
        { Key: "ManagedBy", Value: "gitterm" },
        { Key: "Purpose", Value: "workspace-task-role" },
      ],
    }),
  );

  const arn = response.Role?.Arn;
  if (!arn) {
    throw new Error(`Created ${roleName} role but AWS did not return its ARN.`);
  }

  await ensureTaskRoleIntrospectionPolicy(iam, roleName);

  return arn;
}

async function ensureTaskRoleIntrospectionPolicy(iam: IAMClient, roleName: string): Promise<void> {
  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: "gitterm-runtime-context-introspection",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "sts:GetCallerIdentity",
              "iam:GetRole",
              "iam:GetRolePolicy",
              "iam:ListRolePolicies",
              "iam:ListAttachedRolePolicies",
              "iam:GetPolicy",
              "iam:GetPolicyVersion",
            ],
            Resource: "*",
          },
        ],
      }),
    }),
  );
}

async function waitForStackDeletion(cf: CloudFormationClient, stackName: string): Promise<void> {
  const deadline = Date.now() + STACK_TIMEOUT_MS;
  let forceDeleteRequested = false;

  while (Date.now() < deadline) {
    const stack = await cf
      .send(new DescribeStacksCommand({ StackName: stackName }))
      .then((response) => response.Stacks?.[0])
      .catch(() => null);

    if (!stack || stack.StackStatus === "DELETE_COMPLETE") {
      return;
    }

    if (stack.StackStatus === "DELETE_FAILED") {
      if (!forceDeleteRequested) {
        forceDeleteRequested = true;
        await cf.send(
          new DeleteStackCommand({
            StackName: stackName,
            DeletionMode: "FORCE_DELETE_STACK",
          }),
        );
        await sleep(STACK_POLL_INTERVAL_MS);
        continue;
      }

      throw new Error(
        `Failed to delete stack ${stackName}: ${stack.StackStatusReason ?? "unknown reason"}`,
      );
    }

    await sleep(STACK_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for stack ${stackName} to be deleted`);
}

async function createOrUpdateStack(
  cf: CloudFormationClient,
  stackName: string,
  templateBody: string,
  parameters: Array<{ ParameterKey: string; ParameterValue: string }>,
): Promise<void> {
  const existing = await cf
    .send(new DescribeStacksCommand({ StackName: stackName }))
    .then((response) => response.Stacks?.[0])
    .catch(() => null);

  if (existing && existing.StackStatus !== "DELETE_COMPLETE") {
    if (existing.StackStatus === "ROLLBACK_COMPLETE" || existing.StackStatus === "CREATE_FAILED") {
      await cf.send(new DeleteStackCommand({ StackName: stackName }));
      await waitForStackDeletion(cf, stackName);
      await cf.send(
        new CreateStackCommand({
          StackName: stackName,
          TemplateBody: templateBody,
          Parameters: parameters,
          Capabilities: ["CAPABILITY_NAMED_IAM"],
          OnFailure: "ROLLBACK",
          Tags: [
            { Key: "ManagedBy", Value: "gitterm" },
            { Key: "Purpose", Value: "workspace-infrastructure" },
          ],
        }),
      );
      return;
    }

    try {
      await cf.send(
        new UpdateStackCommand({
          StackName: stackName,
          TemplateBody: templateBody,
          Parameters: parameters,
          Capabilities: ["CAPABILITY_NAMED_IAM"],
          Tags: [
            { Key: "ManagedBy", Value: "gitterm" },
            { Key: "Purpose", Value: "workspace-infrastructure" },
          ],
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No updates are to be performed")) {
        return;
      }
      throw error;
    }
  } else {
    await cf.send(
      new CreateStackCommand({
        StackName: stackName,
        TemplateBody: templateBody,
        Parameters: parameters,
        Capabilities: ["CAPABILITY_NAMED_IAM"],
        OnFailure: "ROLLBACK",
        Tags: [
          { Key: "ManagedBy", Value: "gitterm" },
          { Key: "Purpose", Value: "workspace-infrastructure" },
        ],
      }),
    );
  }
}

async function waitForStack(
  cf: CloudFormationClient,
  stackName: string,
): Promise<Record<string, string>> {
  const deadline = Date.now() + STACK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await cf.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = response.Stacks?.[0];

    if (!stack) {
      throw new Error(`Stack ${stackName} not found`);
    }

    const status = stack.StackStatus ?? "";

    if (
      status === "CREATE_COMPLETE" ||
      status === "UPDATE_COMPLETE" ||
      status === "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"
    ) {
      const outputs: Record<string, string> = {};
      for (const output of stack.Outputs ?? []) {
        if (output.OutputKey && output.OutputValue) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      }
      return outputs;
    }

    if (
      status.endsWith("_FAILED") ||
      status.endsWith("ROLLBACK_IN_PROGRESS") ||
      status === "ROLLBACK_COMPLETE" ||
      status === "UPDATE_ROLLBACK_COMPLETE"
    ) {
      throw new Error(
        `Stack ${stackName} failed with status ${status}: ${stack.StackStatusReason ?? "unknown reason"}`,
      );
    }

    await sleep(STACK_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for stack ${stackName}`);
}

function requireOutput(outputs: Record<string, string>, key: string): string {
  const value = outputs[key];
  if (!value) {
    throw new Error(`Missing expected CloudFormation output: ${key}`);
  }
  return value;
}

export async function bootstrapAwsProvider(input: AwsBootstrapInput): Promise<AwsBootstrapResult> {
  const credentials = {
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
  };
  const region = input.defaultRegion;

  const sts = new STSClient({ region, credentials });
  const ec2 = new EC2Client({ region, credentials });
  const iam = new IAMClient({ region, credentials });
  const cf = new CloudFormationClient({ region, credentials });

  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;
  if (!accountId) {
    throw new Error("Failed to resolve AWS account ID for the provided credentials.");
  }

  const vpcId = await findDefaultVpc(ec2);
  const subnetIds = await findPublicSubnetIds(ec2, vpcId);
  const ensuredTaskRoleArn = await ensureTaskRoleArn(iam, region);

  const stackName = buildStackName(region);
  const templateBody = buildTemplate(subnetIds.length);

  const parameters = [
    { ParameterKey: "VpcId", ParameterValue: vpcId },
    { ParameterKey: "ExistingTaskRoleArn", ParameterValue: ensuredTaskRoleArn },
    { ParameterKey: "PublicSshEnabled", ParameterValue: input.publicSshEnabled ? "true" : "false" },
    ...subnetIds.map((id, i) => ({
      ParameterKey: `Subnet${i + 1}`,
      ParameterValue: id,
    })),
  ];

  await createOrUpdateStack(cf, stackName, templateBody, parameters);
  const outputs = await waitForStack(cf, stackName);

  const clusterArn = requireOutput(outputs, "ClusterArn");
  const albDnsName = requireOutput(outputs, "AlbDnsName");
  const albListenerArn = requireOutput(outputs, "AlbListenerArn");
  const workspaceSecurityGroupId = requireOutput(outputs, "WorkspaceSecurityGroupId");
  const taskExecutionRoleArn = requireOutput(outputs, "TaskExecutionRoleArn");
  const taskRoleArn = requireOutput(outputs, "TaskRoleArn");
  const logGroupName = requireOutput(outputs, "LogGroupName");
  const efsFileSystemId = requireOutput(outputs, "EfsFileSystemId");

  return {
    config: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      defaultRegion: region,
      clusterArn,
      vpcId,
      subnetIds: subnetIds.join(","),
      securityGroupIds: workspaceSecurityGroupId,
      albListenerArn,
      albBaseUrl: `http://${albDnsName}`,
      taskExecutionRoleArn,
      taskRoleArn,
      assignPublicIp: true,
      publicSshEnabled: input.publicSshEnabled ?? false,
      efsFileSystemId,
      logGroupName,
    },
    summary: {
      accountId,
      region,
      stackName,
      vpcId,
      subnetIds,
      albDnsName,
      albListenerArn,
      clusterArn,
      securityGroupIds: [workspaceSecurityGroupId],
      taskExecutionRoleArn,
      taskRoleArn,
      logGroupName,
      efsFileSystemId,
    },
  };
}

export async function deleteAwsProviderInfrastructure(
  input: AwsBootstrapInput,
): Promise<AwsDeleteInfrastructureResult> {
  const credentials = {
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
  };
  const region = input.defaultRegion;
  const cf = new CloudFormationClient({ region, credentials });
  const stackName = buildStackName(region);

  const existing = await cf
    .send(new DescribeStacksCommand({ StackName: stackName }))
    .then((response) => response.Stacks?.[0])
    .catch(() => null);

  if (!existing || existing.StackStatus === "DELETE_COMPLETE") {
    return { deleted: false, stackName };
  }

  await cf.send(new DeleteStackCommand({ StackName: stackName }));
  await waitForStackDeletion(cf, stackName);

  return { deleted: true, stackName };
}
