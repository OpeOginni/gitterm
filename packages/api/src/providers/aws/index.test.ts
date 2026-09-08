import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ECSClient } from "@aws-sdk/client-ecs";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { EFSClient } from "@aws-sdk/client-efs";
import { EC2Client } from "@aws-sdk/client-ec2";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { AwsProvider, type AwsConfig } from ".";
import type { WorkspaceConfig } from "../compute";

const config: AwsConfig = {
  accessKeyId: "test",
  secretAccessKey: "test",
  defaultRegion: "eu-central-1",
  clusterArn: "cluster",
  vpcId: "vpc",
  subnetIds: "subnet-a, subnet-b",
  securityGroupIds: "sg",
  albListenerArn: "listener",
  albBaseUrl: "http://alb.example.com/",
  taskRoleArn: "arn:aws:iam::123456789012:role/PresentationRole",
  taskExecutionRoleArn: "execution-role",
  assignPublicIp: true,
  publicSshEnabled: true,
  efsFileSystemId: "fs-test",
};
const handle = {
  workspaceId: "workspace-id",
  region: config.defaultRegion,
  clusterArn: config.clusterArn,
  serviceArn: "service",
  serviceName: "gitterm-workspace-id",
  taskDefinitionArn: "task-def",
  targetGroupArn: "main-tg",
  listenerRuleArn: "main-rule",
  workspaceHost: "workspace-id.workspace.aws.gitterm.internal",
};
let provider: AwsProvider;
let commands: any[];
let service: any;
beforeEach(() => {
  provider = new AwsProvider();
  spyOn(provider, "getConfig").mockResolvedValue(config);
  commands = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => new Response("ok", { status: 200 }), { preconnect: () => {} }),
  );
  spyOn(SecretsManagerClient.prototype, "send").mockImplementation(async (command: any) => {
    commands.push(command);
    if (command.constructor.name === "CreateSecretCommand")
      return {
        ARN: "arn:aws:secretsmanager:eu-central-1:123456789012:secret:gitterm/workspaces/workspace-id-abcdef",
      };
    if (command.constructor.name === "ListSecretsCommand") return { SecretList: [] };
    if (command.constructor.name === "DeleteSecretCommand") return {};
    throw new Error(`Unexpected secret command ${command.constructor.name}`);
  });
  service = { status: "ACTIVE", desiredCount: 1, runningCount: 1 };
  spyOn(ECSClient.prototype, "send").mockImplementation(async (command: any) => {
    commands.push(command);
    switch (command.constructor.name) {
      case "RegisterTaskDefinitionCommand":
        return { taskDefinition: { taskDefinitionArn: "task-def" } };
      case "CreateServiceCommand":
        return { service: { serviceArn: "service" } };
      case "DescribeServicesCommand":
        return { services: [service] };
      case "ListTasksCommand":
        return { taskArns: ["task"] };
      case "DescribeTasksCommand":
        return {
          tasks: [
            {
              attachments: [
                {
                  details: [
                    { name: "privateIPv4Address", value: "10.0.0.2" },
                    { name: "networkInterfaceId", value: "eni-task" },
                  ],
                },
              ],
            },
          ],
        };
      case "TagResourceCommand":
      case "UpdateServiceCommand":
      case "DeleteServiceCommand":
      case "DeregisterTaskDefinitionCommand":
        return {};
      default:
        throw new Error(`Unexpected ECS command ${command.constructor.name}`);
    }
  });
  spyOn(ElasticLoadBalancingV2Client.prototype, "send").mockImplementation(async (command: any) => {
    commands.push(command);
    switch (command.constructor.name) {
      case "CreateTargetGroupCommand":
        return { TargetGroups: [{ TargetGroupArn: "main-tg" }] };
      case "CreateRuleCommand":
        return { Rules: [{ RuleArn: "main-rule" }] };
      case "DescribeRulesCommand":
        return { Rules: [] };
      case "DescribeTargetHealthCommand":
        return {
          TargetHealthDescriptions: [
            { Target: { Id: "10.0.0.1", Port: 4096 }, TargetHealth: { State: "healthy" } },
          ],
        };
      case "AddTagsCommand":
      case "ModifyTargetGroupAttributesCommand":
      case "DeregisterTargetsCommand":
      case "RegisterTargetsCommand":
      case "DeleteRuleCommand":
      case "DeleteTargetGroupCommand":
        return {};
      default:
        throw new Error(`Unexpected ALB command ${command.constructor.name}`);
    }
  });
  spyOn(EFSClient.prototype, "send").mockImplementation(async (command: any) => {
    commands.push(command);
    if (command.constructor.name === "CreateAccessPointCommand")
      return { AccessPointId: "fsap-test", AccessPointArn: "access-point-arn" };
    if (["TagResourceCommand", "DeleteAccessPointCommand"].includes(command.constructor.name))
      return {};
    throw new Error(`Unexpected EFS command ${command.constructor.name}`);
  });
  spyOn(EC2Client.prototype, "send").mockImplementation(async () => ({
    NetworkInterfaces: [{ Association: { PublicIp: "203.0.113.10" } }],
  }));
});
afterEach(() => mock.restore());
const commandInput = (name: string) =>
  commands.find((command) => command.constructor.name === name)?.input;

describe("AWS workspace lifecycle", () => {
  test("persists its handle before readiness and rejects an auth challenge", async () => {
    const onProvisioned = mock(async () => {});
    const future = Date.now() + 180001;
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          expect(onProvisioned).toHaveBeenCalledTimes(1);
          spyOn(Date, "now").mockReturnValue(future);
          return new Response("unauthorized", { status: 401 });
        },
        { preconnect: () => {} },
      ),
    );
    await expect(
      provider.createWorkspace({
        workspaceId: "test",
        userId: "user",
        imageId: "image",
        subdomain: "test",
        onProvisioned,
      }),
    ).rejects.toThrow("three-minute");
    expect(commandInput("DeleteServiceCommand").force).toBe(true);
    expect(commandInput("DeleteSecretCommand").RecoveryWindowInDays).toBe(7);
  });

  test("captures ECS diagnostics before reporting a readiness timeout", async () => {
    service.events = [{ message: "target failed health checks", createdAt: new Date() }];
    try {
      await (provider as any).waitForTargetGroupHealthy(
        "target",
        config.defaultRegion,
        Date.now() - 1,
        "service",
      );
      throw new Error("Expected timeout");
    } catch (error) {
      expect((error as any).diagnostics.events[0].message).toBe("target failed health checks");
      expect((error as any).diagnostics.tasks).toHaveLength(1);
    }
  });

  test("orphan sweep keeps going after a failed deletion and reports it", async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const tags = (workspaceId: string) => [
      { key: "ManagedBy", value: "gitterm" },
      { key: "WorkspaceId", value: workspaceId },
      { key: "CreatedAt", value: old },
    ];
    spyOn(ECSClient.prototype, "send").mockImplementation(async (command: any) => {
      switch (command.constructor.name) {
        case "ListServicesCommand":
          return { serviceArns: ["arn:ecs/gitterm-broken", "arn:ecs/gitterm-orphan"] };
        case "ListTagsForResourceCommand":
          return { tags: tags(command.input.resourceArn.split("gitterm-")[1]) };
        case "DescribeServicesCommand":
          return {
            services: [{ taskDefinition: "arn:ecs:task-definition/gitterm-workspace-x:1" }],
          };
        case "DeleteServiceCommand":
          if (command.input.service === "arn:ecs/gitterm-broken") throw new Error("AccessDenied");
          return {};
        case "DeregisterTaskDefinitionCommand":
          return {};
        case "ListTaskDefinitionsCommand":
          return { taskDefinitionArns: [] };
        default:
          throw new Error(`Unexpected ECS command ${command.constructor.name}`);
      }
    });
    spyOn(ElasticLoadBalancingV2Client.prototype, "send").mockImplementation(
      async (command: any) => {
        if (command.constructor.name === "DescribeRulesCommand") return { Rules: [] };
        if (command.constructor.name === "DescribeTargetGroupsCommand") return { TargetGroups: [] };
        throw new Error(`Unexpected ALB command ${command.constructor.name}`);
      },
    );
    spyOn(EFSClient.prototype, "send").mockImplementation(async () => ({ AccessPoints: [] }));

    const result = await provider.sweepOrphanedResources(["active"], config.defaultRegion);

    expect(result.servicesDeleted).toBe(1);
    expect(result.taskDefinitionsDeregistered).toBe(1);
    expect(result.failures).toEqual([
      { resource: "arn:ecs/gitterm-broken", reason: expect.stringContaining("AccessDenied") },
    ]);
  });

  test("a task that cannot start fails fast with the ECS reason", async () => {
    const stoppedReason =
      "ResourceInitializationError: unable to pull secrets or registry auth: User: arn:aws:sts::123456789012:assumed-role/gitterm-task-execution-eu-central-1/abc is not authorized to perform: secretsmanager:GetSecretValue on resource: x";
    spyOn(ElasticLoadBalancingV2Client.prototype, "send").mockImplementation(async () => ({
      TargetHealthDescriptions: [],
    }));
    spyOn(ECSClient.prototype, "send").mockImplementation(async (command: any) => {
      if (command.constructor.name === "ListTasksCommand")
        return { taskArns: command.input.desiredStatus === "STOPPED" ? ["task"] : [] };
      if (command.constructor.name === "DescribeTasksCommand")
        return { tasks: [{ taskArn: "task", stopCode: "TaskFailedToStart", stoppedReason }] };
      throw new Error(`Unexpected ECS command ${command.constructor.name}`);
    });
    const started = Date.now();
    await expect(
      (provider as any).waitForTargetGroupHealthy(
        "target",
        config.defaultRegion,
        Date.now() + 60_000,
        "arn:ecs/gitterm-workspace-id",
      ),
    ).rejects.toMatchObject({
      name: "AwsPermissionError",
      action: "secretsmanager:GetSecretValue",
      message: expect.stringContaining("for gitterm-task-execution-eu-central-1"),
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("a denied AWS action surfaces as an actionable permission error", async () => {
    spyOn(SecretsManagerClient.prototype, "send").mockImplementation(async () => {
      throw Object.assign(
        new Error(
          "User: arn:aws:iam::123456789012:user/gitterm is not authorized to perform: secretsmanager:CreateSecret on resource: gitterm/workspaces/workspace-id",
        ),
        { name: "AccessDeniedException" },
      );
    });
    const attempt = provider.createWorkspace({
      workspaceId: handle.workspaceId,
      userId: "user",
      imageId: "registry/image:latest",
      subdomain: "demo",
      regionIdentifier: config.defaultRegion,
      environmentVariables: { WORKSPACE_AUTH_TOKEN: "token" } as any,
    });
    await expect(attempt).rejects.toMatchObject({
      name: "AwsPermissionError",
      action: "secretsmanager:CreateSecret",
    });
    await expect(attempt).rejects.toThrow("Re-apply the generated deployment policy");
    expect(commandInput("DeleteTargetGroupCommand")).toBeDefined();
  });

  test("termination does not hide AWS deletion failures", async () => {
    spyOn(ECSClient.prototype, "send").mockImplementation(async () => {
      throw new Error("AccessDenied");
    });
    await expect(provider.terminateWorkspace(JSON.stringify(handle))).rejects.toThrow(
      "AccessDenied",
    );
  });

  test.each([false, true])(
    "provisions current container payload (persistent=%s)",
    async (persistent) => {
      const workspace: WorkspaceConfig = {
        workspaceId: handle.workspaceId,
        userId: "user",
        imageId: "registry/image:latest",
        subdomain: "demo",
        regionIdentifier: config.defaultRegion,
        awsTaskRoleArn: "arn:aws:iam::123456789012:role/SelectedProfile",
        imageProviderMetadata: {
          aws: { cpu: 1024, memory: 2048, architecture: "ARM64", containerPort: 4096 },
        },
        environmentVariables: {
          AGENT_FILES_BASE64: "encoded-files",
          WORKSPACE_BEFORE_AGENT_COMMAND_BASE64: "setup",
          EDITOR_ACCESS_ENABLED: "true",
        } as any,
      };
      const result = persistent
        ? await provider.createPersistentWorkspace({ ...workspace, persistent: true })
        : await provider.createWorkspace(workspace);
      const task = commandInput("RegisterTaskDefinitionCommand");
      expect(task.taskRoleArn).toBe(workspace.awsTaskRoleArn);
      expect(task.executionRoleArn).toBe(config.taskExecutionRoleArn);
      expect(task.cpu).toBe("1024");
      expect(task.memory).toBe("2048");
      expect(task.runtimePlatform.cpuArchitecture).toBe("ARM64");
      expect(task.containerDefinitions[0].environment).toBeUndefined();
      expect(task.containerDefinitions[0].secrets).toContainEqual({
        name: "AGENT_FILES_BASE64",
        valueFrom:
          "arn:aws:secretsmanager:eu-central-1:123456789012:secret:gitterm/workspaces/workspace-id-abcdef:AGENT_FILES_BASE64::",
      });
      expect(JSON.stringify(task)).not.toContain("encoded-files");
      expect(JSON.parse(commandInput("CreateSecretCommand").SecretString).AGENT_FILES_BASE64).toBe(
        "encoded-files",
      );
      expect(commandInput("CreateServiceCommand").healthCheckGracePeriodSeconds).toBe(180);
      expect(commandInput("CreateTargetGroupCommand").HealthCheckIntervalSeconds).toBe(5);
      expect(task.containerDefinitions[0].portMappings).toContainEqual({
        containerPort: 22,
        protocol: "tcp",
      });
      expect(
        commandInput("CreateServiceCommand").networkConfiguration.awsvpcConfiguration.subnets,
      ).toEqual(["subnet-a", "subnet-b"]);
      expect(result.upstreamUrl).toBe("http://alb.example.com");
      expect(result.upstreamAccess?.headers["X-GitTerm-Aws-Routing-Key"]).toBe(
        handle.workspaceHost,
      );
      if (persistent) {
        expect((result as any).externalVolumeId).toBe("fsap-test");
        expect(task.volumes[0].efsVolumeConfiguration.authorizationConfig.accessPointId).toBe(
          "fsap-test",
        );
        expect(task.containerDefinitions[0].mountPoints[0].containerPath).toBe("/workspace");
      } else expect(task.volumes).toBeUndefined();
    },
  );

  test("pause scales down; status reflects desired/running task counts", async () => {
    await provider.pauseWorkspace(JSON.stringify(handle));
    expect(commandInput("UpdateServiceCommand").desiredCount).toBe(0);
    expect((await provider.getStatus(JSON.stringify(handle))).status).toBe("running");
    service = { desiredCount: 0, runningCount: 0, status: "ACTIVE" };
    expect((await provider.getStatus(JSON.stringify(handle))).status).toBe("paused");
    service = { desiredCount: 1, runningCount: 0, status: "ACTIVE" };
    expect((await provider.getStatus(JSON.stringify(handle))).status).toBe("pending");
    service = { status: "INACTIVE" };
    expect((await provider.getStatus(JSON.stringify(handle))).status).toBe("terminated");
  });

  test("resume refreshes only this workspace's extra ports, including paginated rules", async () => {
    const original = (ElasticLoadBalancingV2Client.prototype.send as any).getMockImplementation();
    spyOn(ElasticLoadBalancingV2Client.prototype, "send").mockImplementation(async function (
      this: any,
      command: any,
    ) {
      if (command.constructor.name !== "DescribeRulesCommand") return original.call(this, command);
      commands.push(command);
      if (!command.input.Marker) return { Rules: [], NextMarker: "page-2" };
      return {
        Rules: ["workspace-id", "another-workspace"].map((id) => ({
          Actions: [{ Type: "forward", TargetGroupArn: `${id}-port-tg` }],
          Conditions: [
            {
              Field: "http-header",
              HttpHeaderConfig: {
                HttpHeaderName: "X-GitTerm-Aws-Routing-Key",
                Values: [`3000-${id}.workspace.aws.gitterm.internal`],
              },
            },
          ],
        })),
      };
    });
    await provider.resumeWorkspace(JSON.stringify(handle));
    expect(commandInput("UpdateServiceCommand").desiredCount).toBe(1);
    const registrations = commands.filter(
      (command) => command.constructor.name === "RegisterTargetsCommand",
    );
    expect(registrations.map((command) => command.input)).toEqual([
      { TargetGroupArn: "workspace-id-port-tg", Targets: [{ Id: "10.0.0.2", Port: 3000 }] },
    ]);
  });

  test("returns native SSH access using the task's public IP", async () => {
    const result = await provider.getWorkspaceSSHAccess({
      externalServiceId: JSON.stringify(handle),
      subdomain: "demo",
    } as any);
    expect(result.host).toBe("203.0.113.10");
    expect(result.port).toBe(22);
    expect(result.transportKind).toBe("direct-ssh");
  });

  test("terminates service, main routing, task definition and persistent access point", async () => {
    service = { status: "INACTIVE" };
    await provider.terminateWorkspace(JSON.stringify(handle), "fsap-test");
    expect(commandInput("DeleteServiceCommand").service).toBe(handle.serviceArn);
    expect(commandInput("DeleteRuleCommand").RuleArn).toBe(handle.listenerRuleArn);
    expect(commandInput("DeleteTargetGroupCommand").TargetGroupArn).toBe(handle.targetGroupArn);
    expect(commandInput("DeregisterTaskDefinitionCommand").taskDefinition).toBe(
      handle.taskDefinitionArn,
    );
    expect(commandInput("DeleteAccessPointCommand").AccessPointId).toBe("fsap-test");
  });
});
