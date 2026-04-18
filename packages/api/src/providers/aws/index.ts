import {
  CreateServiceCommand,
  DeleteServiceCommand,
  DeregisterTaskDefinitionCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
  type ContainerDefinition,
} from "@aws-sdk/client-ecs";
import {
  CreateRuleCommand,
  CreateTargetGroupCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  DeregisterTargetsCommand,
  DescribeRulesCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  type Rule,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  CreateAccessPointCommand,
  DeleteAccessPointCommand,
  EFSClient,
} from "@aws-sdk/client-efs";
import { DescribeNetworkInterfacesCommand, EC2Client } from "@aws-sdk/client-ec2";
import env from "@gitterm/env/server";
import type { AwsImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import type {
  WorkspaceEditorAccess,
  WorkspaceEditorAccessCleanupConfig,
  WorkspaceEditorAccessConfig,
} from "../editor-access";
import type { AwsConfig, AwsExternalPortDomainId, AwsExternalServiceId } from "./types";

export type { AwsConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const CONTAINER_NAME = "workspace";
const DEFAULT_CPU = 1024;
const DEFAULT_MEMORY = 2048;
const DEFAULT_MAIN_PORT = 4096;
const DEFAULT_HEALTH_CHECK_PATH = "/";
const SERVICE_STABILIZATION_TIMEOUT_MS = 3 * 60 * 1000;
const SERVICE_POLL_INTERVAL_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildDomain(subdomain: string): string {
  if (ROUTING_MODE === "path") {
    return BASE_DOMAIN.includes("localhost")
      ? `http://${BASE_DOMAIN}/ws/${subdomain}`
      : `https://${BASE_DOMAIN}/ws/${subdomain}`;
  }

  return BASE_DOMAIN.includes("localhost")
    ? `http://${subdomain}.${BASE_DOMAIN}`
    : `https://${subdomain}.${BASE_DOMAIN}`;
}

function normalizeEnvironmentVariables(
  environmentVariables?: WorkspaceConfig["environmentVariables"],
): Array<{ name: string; value: string }> {
  return Object.entries(environmentVariables ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => ({ name, value }));
}

function getImageMetadata(config: WorkspaceConfig): AwsImageProviderMetadata {
  return config.imageProviderMetadata?.aws ?? {};
}

function buildWorkspaceHost(workspaceId: string): string {
  return `${workspaceId}.workspace.aws.gitterm.internal`;
}

function buildExposedPortHost(workspaceId: string, port: number): string {
  return `${port}-${workspaceId}.workspace.aws.gitterm.internal`;
}

function buildShortId(workspaceId: string): string {
  return workspaceId.replace(/-/g, "").slice(0, 12);
}

function buildServiceName(workspaceId: string): string {
  return `gitterm-${workspaceId}`;
}

function buildTaskFamily(workspaceId: string): string {
  return `gitterm-workspace-${workspaceId}`;
}

function buildTargetGroupName(workspaceId: string, suffix: string): string {
  return `gtm-${buildShortId(workspaceId)}-${suffix}`.slice(0, 32);
}

function serializeExternalServiceId(value: AwsExternalServiceId): string {
  return JSON.stringify(value);
}

function parseExternalServiceId(externalId: string): AwsExternalServiceId {
  try {
    const parsed = JSON.parse(externalId) as AwsExternalServiceId;
    if (
      !parsed?.workspaceId ||
      !parsed?.region ||
      !parsed?.clusterArn ||
      !parsed?.serviceArn ||
      !parsed?.serviceName
    ) {
      throw new Error("Invalid AWS workspace handle");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid AWS external service id: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function serializeExternalPortDomainId(value: AwsExternalPortDomainId): string {
  return JSON.stringify(value);
}

function parseExternalPortDomainId(externalId: string): AwsExternalPortDomainId {
  try {
    const parsed = JSON.parse(externalId) as AwsExternalPortDomainId;
    if (!parsed?.region || !parsed?.listenerRuleArn || !parsed?.targetGroupArn) {
      throw new Error("Invalid AWS exposed port handle");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid AWS external port domain id: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getRuleTargetGroupArn(rule?: Rule): string | undefined {
  return rule?.Actions?.find((action) => action.Type === "forward")?.TargetGroupArn;
}

export class AwsProvider implements ComputeProvider {
  readonly name = "aws";

  async getConfig(): Promise<AwsConfig> {
    const config = await getProviderConfigService().getProviderConfigForUse("aws");

    if (!config) {
      throw new Error("AWS provider is not configured. Please configure it in the admin panel.");
    }

    return config as AwsConfig;
  }

  private async createClients(region?: string) {
    const config = await this.getConfig();
    const targetRegion = region ?? config.defaultRegion;
    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };

    return {
      config,
      ecs: new ECSClient({ region: targetRegion, credentials }),
      elbv2: new ElasticLoadBalancingV2Client({ region: targetRegion, credentials }),
      efs: new EFSClient({ region: targetRegion, credentials }),
      ec2: new EC2Client({ region: targetRegion, credentials }),
    };
  }

  private getMainContainerPort(config: WorkspaceConfig): number {
    return getImageMetadata(config).containerPort ?? DEFAULT_MAIN_PORT;
  }

  private getHealthCheckPath(config: WorkspaceConfig): string {
    return getImageMetadata(config).healthCheckPath ?? DEFAULT_HEALTH_CHECK_PATH;
  }

  private getUpstreamAccessHeaders(host: string): UpstreamAccess {
    return {
      headers: {
        Host: host,
      },
    };
  }

  private async findRuleByHost(listenerArn: string, host: string, region?: string): Promise<Rule | null> {
    const { elbv2 } = await this.createClients(region);
    const response = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));

    return (
      response.Rules?.find((rule) =>
        rule.Conditions?.some(
          (condition) =>
            condition.Field === "host-header" &&
            condition.HostHeaderConfig?.Values?.includes(host),
        ),
      ) ?? null
    );
  }

  private async allocateRulePriority(listenerArn: string, region?: string): Promise<number> {
    const { elbv2 } = await this.createClients(region);
    const response = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
    const priorities = new Set(
      (response.Rules ?? [])
        .map((rule) => Number(rule.Priority))
        .filter((priority) => Number.isInteger(priority) && priority >= 1),
    );

    for (let priority = 1; priority <= 50000; priority += 1) {
      if (!priorities.has(priority)) {
        return priority;
      }
    }

    throw new Error("No available ALB listener rule priority for AWS workspace routing");
  }

  private async waitForServiceState(
    externalId: AwsExternalServiceId,
    predicate: (service: NonNullable<Awaited<ReturnType<AwsProvider["describeService"]>>>) => boolean,
    region?: string,
  ): Promise<void> {
    const deadline = Date.now() + SERVICE_STABILIZATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const service = await this.describeService(externalId, region);
      if (service && predicate(service)) {
        return;
      }

      await sleep(SERVICE_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for AWS service ${externalId.serviceName} to reach target state`);
  }

  private async describeService(externalId: AwsExternalServiceId, region?: string) {
    const { ecs } = await this.createClients(region);
    const response = await ecs.send(
      new DescribeServicesCommand({
        cluster: externalId.clusterArn,
        services: [externalId.serviceArn],
      }),
    );

    return response.services?.[0] ?? null;
  }

  private async waitForServiceRunning(externalId: AwsExternalServiceId, region?: string): Promise<void> {
    await this.waitForServiceState(
      externalId,
      (service) =>
        service.status === "ACTIVE" &&
        (service.runningCount ?? 0) > 0 &&
        (service.pendingCount ?? 0) === 0,
      region,
    );
  }

  private async waitForServiceDeleted(externalId: AwsExternalServiceId, region?: string): Promise<void> {
    const deadline = Date.now() + SERVICE_STABILIZATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const service = await this.describeService(externalId, region);
      if (!service || service.status === "INACTIVE") {
        return;
      }

      await sleep(SERVICE_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for AWS service ${externalId.serviceName} to be deleted`);
  }

  private async resolveTaskIp(externalId: AwsExternalServiceId, region?: string): Promise<string> {
    const { ecs, ec2 } = await this.createClients(region);
    const listedTasks = await ecs.send(
      new ListTasksCommand({
        cluster: externalId.clusterArn,
        serviceName: externalId.serviceName,
        desiredStatus: "RUNNING",
      }),
    );
    const taskArn = listedTasks.taskArns?.[0];

    if (!taskArn) {
      throw new Error(`No running ECS task found for AWS workspace ${externalId.serviceName}`);
    }

    const describedTasks = await ecs.send(
      new DescribeTasksCommand({
        cluster: externalId.clusterArn,
        tasks: [taskArn],
      }),
    );
    const task = describedTasks.tasks?.[0];
    const attachmentDetails = task?.attachments?.flatMap((attachment) => attachment.details ?? []) ?? [];
    const privateIp = attachmentDetails.find((detail) => detail.name === "privateIPv4Address")?.value;

    if (privateIp) {
      return privateIp;
    }

    const networkInterfaceId = attachmentDetails.find(
      (detail) => detail.name === "networkInterfaceId",
    )?.value;

    if (!networkInterfaceId) {
      throw new Error(`No network interface found for AWS workspace ${externalId.serviceName}`);
    }

    const networkInterfaces = await ec2.send(
      new DescribeNetworkInterfacesCommand({
        NetworkInterfaceIds: [networkInterfaceId],
      }),
    );
    const resolvedPrivateIp = networkInterfaces.NetworkInterfaces?.[0]?.PrivateIpAddress;

    if (!resolvedPrivateIp) {
      throw new Error(`No private IP found for AWS workspace ${externalId.serviceName}`);
    }

    return resolvedPrivateIp;
  }

  private async refreshTargetGroupRegistration(
    targetGroupArn: string,
    targetIp: string,
    port: number,
    region?: string,
  ): Promise<void> {
    const { elbv2 } = await this.createClients(region);
    const existingHealth = await elbv2.send(
      new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }),
    );
    const existingTargets =
      existingHealth.TargetHealthDescriptions?.flatMap((description) =>
        description.Target?.Id ? [{ Id: description.Target.Id, Port: description.Target.Port }] : [],
      ) ?? [];

    if (existingTargets.length > 0) {
      await elbv2.send(
        new DeregisterTargetsCommand({
          TargetGroupArn: targetGroupArn,
          Targets: existingTargets,
        }),
      );
    }

    await elbv2.send(
      new RegisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [{ Id: targetIp, Port: port }],
      }),
    );
  }

  private async deleteRuleIfExists(ruleArn: string, region?: string): Promise<void> {
    const { elbv2 } = await this.createClients(region);

    await elbv2.send(new DeleteRuleCommand({ RuleArn: ruleArn })).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("RuleNotFound") && !message.includes("not found")) {
        throw error;
      }
    });
  }

  private async deleteTargetGroupIfExists(targetGroupArn: string, region?: string): Promise<void> {
    const { elbv2 } = await this.createClients(region);

    await elbv2.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn })).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("TargetGroupNotFound") && !message.includes("not found")) {
        throw error;
      }
    });
  }

  private async deleteAccessPointIfExists(accessPointArn: string, region?: string): Promise<void> {
    const { efs } = await this.createClients(region);

    await efs.send(new DeleteAccessPointCommand({ AccessPointId: accessPointArn })).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("AccessPointNotFound") && !message.includes("not found")) {
        throw error;
      }
    });
  }

  private async registerTaskDefinition(
    config: WorkspaceConfig,
    region?: string,
    accessPointArn?: string,
  ): Promise<string> {
    const { ecs, config: providerConfig } = await this.createClients(region);
    const metadata = getImageMetadata(config);
    const containerPort = this.getMainContainerPort(config);
    const containerDefinition: ContainerDefinition = {
      name: CONTAINER_NAME,
      image: config.imageId,
      essential: true,
      portMappings: [{ containerPort, protocol: "tcp" }],
      environment: normalizeEnvironmentVariables(config.environmentVariables),
    };

    if (providerConfig.logGroupName) {
      containerDefinition.logConfiguration = {
        logDriver: "awslogs",
        options: {
          "awslogs-group": providerConfig.logGroupName,
          "awslogs-region": region ?? providerConfig.defaultRegion,
          "awslogs-stream-prefix": "gitterm",
        },
      };
    }

    const mountPoints = accessPointArn
      ? [{ sourceVolume: "workspace", containerPath: "/workspace", readOnly: false }]
      : undefined;

    if (mountPoints) {
      containerDefinition.mountPoints = mountPoints;
    }

    const response = await ecs.send(
      new RegisterTaskDefinitionCommand({
        family: buildTaskFamily(config.workspaceId),
        cpu: String(metadata.cpu ?? DEFAULT_CPU),
        memory: String(metadata.memory ?? DEFAULT_MEMORY),
        networkMode: "awsvpc",
        requiresCompatibilities: ["FARGATE"],
        executionRoleArn: providerConfig.taskExecutionRoleArn,
        taskRoleArn: providerConfig.taskRoleArn,
        runtimePlatform: metadata.architecture
          ? {
              operatingSystemFamily: "LINUX",
              cpuArchitecture: metadata.architecture,
            }
          : undefined,
        ephemeralStorage: metadata.ephemeralStorageGiB
          ? { sizeInGiB: metadata.ephemeralStorageGiB }
          : undefined,
        volumes: accessPointArn
          ? [
              {
                name: "workspace",
                efsVolumeConfiguration: {
                  fileSystemId: providerConfig.efsFileSystemId,
                  transitEncryption: "ENABLED",
                  authorizationConfig: {
                    accessPointId: accessPointArn,
                    iam: "DISABLED",
                  },
                },
              },
            ]
          : undefined,
        containerDefinitions: [containerDefinition],
      }),
    );

    const taskDefinitionArn = response.taskDefinition?.taskDefinitionArn;
    if (!taskDefinitionArn) {
      throw new Error(`Failed to register ECS task definition for workspace ${config.workspaceId}`);
    }

    return taskDefinitionArn;
  }

  private async createMainTargetGroup(config: WorkspaceConfig, region?: string): Promise<string> {
    const { elbv2, config: providerConfig } = await this.createClients(region);
    const response = await elbv2.send(
      new CreateTargetGroupCommand({
        Name: buildTargetGroupName(config.workspaceId, "main"),
        TargetType: "ip",
        Protocol: "HTTP",
        Port: this.getMainContainerPort(config),
        VpcId: providerConfig.vpcId,
        HealthCheckProtocol: "HTTP",
        HealthCheckPath: this.getHealthCheckPath(config),
        Matcher: { HttpCode: "200-499" },
      }),
    );
    const targetGroupArn = response.TargetGroups?.[0]?.TargetGroupArn;

    if (!targetGroupArn) {
      throw new Error(`Failed to create ALB target group for workspace ${config.workspaceId}`);
    }

    return targetGroupArn;
  }

  private async createListenerRule(
    listenerArn: string,
    host: string,
    targetGroupArn: string,
    region?: string,
  ): Promise<string> {
    const { elbv2 } = await this.createClients(region);
    const response = await elbv2.send(
      new CreateRuleCommand({
        ListenerArn: listenerArn,
        Priority: await this.allocateRulePriority(listenerArn, region),
        Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [host] } }],
        Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }],
      }),
    );
    const ruleArn = response.Rules?.[0]?.RuleArn;

    if (!ruleArn) {
      throw new Error(`Failed to create ALB listener rule for host ${host}`);
    }

    return ruleArn;
  }

  private async createEfsAccessPoint(config: WorkspaceConfig, region?: string): Promise<string> {
    const { efs, config: providerConfig } = await this.createClients(region);

    if (!providerConfig.efsFileSystemId) {
      throw new Error("AWS persistent workspaces require an EFS file system ID");
    }

    const response = await efs.send(
      new CreateAccessPointCommand({
        FileSystemId: providerConfig.efsFileSystemId,
        PosixUser: {
          Uid: 1000,
          Gid: 1000,
        },
        RootDirectory: {
          Path: `/gitterm/${config.workspaceId}`,
          CreationInfo: {
            OwnerUid: 1000,
            OwnerGid: 1000,
            Permissions: "755",
          },
        },
      }),
    );
    const accessPointArn = response.AccessPointArn;

    if (!accessPointArn) {
      throw new Error(`Failed to create EFS access point for workspace ${config.workspaceId}`);
    }

    return accessPointArn;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const providerRegion = config.regionIdentifier;
    const { ecs, config: providerConfig } = await this.createClients(providerRegion);
    const workspaceHost = buildWorkspaceHost(config.workspaceId);
    const targetGroupArn = await this.createMainTargetGroup(config, providerRegion);
    let listenerRuleArn: string | undefined;
    let taskDefinitionArn: string | undefined;
    let serviceArn: string | undefined;
    let accessPointArn: string | undefined;

    try {
      if (persistent) {
        accessPointArn = await this.createEfsAccessPoint(config, providerRegion);
      }

      taskDefinitionArn = await this.registerTaskDefinition(
        config,
        providerRegion,
        accessPointArn,
      );
      listenerRuleArn = await this.createListenerRule(
        providerConfig.albListenerArn,
        workspaceHost,
        targetGroupArn,
        providerRegion,
      );

      const serviceResponse = await ecs.send(
        new CreateServiceCommand({
          cluster: providerConfig.clusterArn,
          serviceName: buildServiceName(config.workspaceId),
          taskDefinition: taskDefinitionArn,
          launchType: "FARGATE",
          desiredCount: 1,
          healthCheckGracePeriodSeconds: 60,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: parseCsv(providerConfig.subnetIds),
              securityGroups: parseCsv(providerConfig.securityGroupIds),
              assignPublicIp: providerConfig.assignPublicIp ? "ENABLED" : "DISABLED",
            },
          },
          loadBalancers: [
            {
              targetGroupArn,
              containerName: CONTAINER_NAME,
              containerPort: this.getMainContainerPort(config),
            },
          ],
          platformVersion: "LATEST",
        }),
      );
      serviceArn = serviceResponse.service?.serviceArn;

      if (!serviceArn || !listenerRuleArn || !taskDefinitionArn) {
        throw new Error(`Failed to create AWS ECS service for workspace ${config.workspaceId}`);
      }

      const externalId: AwsExternalServiceId = {
        workspaceId: config.workspaceId,
        region: providerRegion ?? providerConfig.defaultRegion,
        clusterArn: providerConfig.clusterArn,
        serviceArn,
        serviceName: buildServiceName(config.workspaceId),
        taskDefinitionArn,
        targetGroupArn,
        listenerRuleArn,
        workspaceHost,
      };

      await this.waitForServiceRunning(externalId, providerRegion);

      const upstreamUrl = trimTrailingSlash(providerConfig.albBaseUrl);
      const workspaceInfo: WorkspaceInfo = {
        externalServiceId: serializeExternalServiceId(externalId),
        upstreamUrl,
        upstreamAccess: this.getUpstreamAccessHeaders(workspaceHost),
        domain: buildDomain(config.subdomain),
        serviceCreatedAt: new Date(),
      };

      if (!persistent || !accessPointArn) {
        return workspaceInfo;
      }

      return {
        ...workspaceInfo,
        externalVolumeId: accessPointArn,
        volumeCreatedAt: new Date(),
      };
    } catch (error) {
      if (serviceArn) {
        await ecs
          .send(
            new DeleteServiceCommand({
              cluster: providerConfig.clusterArn,
              service: serviceArn,
              force: true,
            }),
          )
          .catch(() => undefined);
      }

      if (listenerRuleArn) {
        await this.deleteRuleIfExists(listenerRuleArn, providerRegion).catch(() => undefined);
      }

      await this.deleteTargetGroupIfExists(targetGroupArn, providerRegion).catch(() => undefined);

      if (taskDefinitionArn) {
        await ecs
          .send(new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefinitionArn }))
          .catch(() => undefined);
      }

      if (accessPointArn) {
        await this.deleteAccessPointIfExists(accessPointArn, providerRegion).catch(() => undefined);
      }

      throw error;
    }
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return (await this.provisionWorkspace(config, false)) as WorkspaceInfo;
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    return (await this.provisionWorkspace(config, true)) as PersistentWorkspaceInfo;
  }

  async stopWorkspace(
    externalId: string,
    regionIdentifier?: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const handle = parseExternalServiceId(externalId);
    const { ecs } = await this.createClients(regionIdentifier);

    await ecs.send(
      new UpdateServiceCommand({
        cluster: handle.clusterArn,
        service: handle.serviceArn,
        desiredCount: 0,
      }),
    );
  }

  async restartWorkspace(
    externalId: string,
    regionIdentifier?: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const handle = parseExternalServiceId(externalId);
    const { ecs } = await this.createClients(regionIdentifier);

    await ecs.send(
      new UpdateServiceCommand({
        cluster: handle.clusterArn,
        service: handle.serviceArn,
        desiredCount: 1,
      }),
    );
    await this.waitForServiceRunning(handle, regionIdentifier);
  }

  async terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void> {
    const handle = parseExternalServiceId(externalServiceId);
    const { ecs } = await this.createClients(handle.region);

    await this.deleteRuleIfExists(handle.listenerRuleArn, handle.region).catch(() => undefined);

    await ecs
      .send(
        new DeleteServiceCommand({
          cluster: handle.clusterArn,
          service: handle.serviceArn,
          force: true,
        }),
      )
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ServiceNotFound") && !message.includes("not found")) {
          throw error;
        }
      });

    await this.waitForServiceDeleted(handle, handle.region).catch(() => undefined);
    await this.deleteTargetGroupIfExists(handle.targetGroupArn, handle.region).catch(() => undefined);

    await ecs
      .send(new DeregisterTaskDefinitionCommand({ taskDefinition: handle.taskDefinitionArn }))
      .catch(() => undefined);

    if (externalVolumeId) {
      await this.deleteAccessPointIfExists(externalVolumeId, handle.region).catch(() => undefined);
    }
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    const handle = parseExternalServiceId(externalId);
    const service = await this.describeService(handle, handle.region);

    if (!service || service.status === "INACTIVE") {
      return { status: "terminated" };
    }

    if ((service.desiredCount ?? 0) === 0) {
      return {
        status: "stopped",
        lastActiveAt: service.createdAt,
      };
    }

    if ((service.runningCount ?? 0) > 0) {
      return {
        status: "running",
        lastActiveAt: service.createdAt,
      };
    }

    return {
      status: "pending",
      lastActiveAt: service.createdAt,
    };
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const handle = parseExternalServiceId(externalServiceId);
    const { elbv2, config } = await this.createClients(handle.region);
    const workspaceHost = buildExposedPortHost(handle.workspaceId, port);
    const rule = await this.findRuleByHost(config.albListenerArn, workspaceHost, handle.region).catch(
      () => null,
    );
    let targetGroupArn = getRuleTargetGroupArn(rule ?? undefined);
    let listenerRuleArn = rule?.RuleArn;

    if (!targetGroupArn) {
      const targetGroupResponse = await elbv2.send(
        new CreateTargetGroupCommand({
          Name: buildTargetGroupName(handle.workspaceId, `p${port}`),
          TargetType: "ip",
          Protocol: "HTTP",
          Port: port,
          VpcId: config.vpcId,
          HealthCheckProtocol: "HTTP",
          HealthCheckPath: DEFAULT_HEALTH_CHECK_PATH,
          Matcher: { HttpCode: "200-499" },
        }),
      );
      targetGroupArn = targetGroupResponse.TargetGroups?.[0]?.TargetGroupArn;
      if (!targetGroupArn) {
        throw new Error(`Failed to create AWS exposed port target group for port ${port}`);
      }
    }

    const taskIp = await this.resolveTaskIp(handle, handle.region);
    await this.refreshTargetGroupRegistration(targetGroupArn, taskIp, port, handle.region);

    if (!listenerRuleArn) {
      listenerRuleArn = await this.createListenerRule(
        config.albListenerArn,
        workspaceHost,
        targetGroupArn,
        handle.region,
      );
    }

    return {
      domain: trimTrailingSlash(config.albBaseUrl),
      externalPortDomainId: serializeExternalPortDomainId({
        region: handle.region,
        listenerRuleArn,
        targetGroupArn,
        workspaceHost,
      }),
      upstreamAccess: this.getUpstreamAccessHeaders(workspaceHost),
    };
  }

  async getWorkspaceEditorAccess(
    _config: WorkspaceEditorAccessConfig,
  ): Promise<WorkspaceEditorAccess> {
    throw new Error("AWS provider does not currently support editor SSH access.");
  }

  async revokeWorkspaceEditorAccess(_config: WorkspaceEditorAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(externalServiceDomainId: string): Promise<void> {
    const handle = parseExternalPortDomainId(externalServiceDomainId);
    await this.deleteRuleIfExists(handle.listenerRuleArn, handle.region).catch(() => undefined);
    await this.deleteTargetGroupIfExists(handle.targetGroupArn, handle.region).catch(() => undefined);
  }
}

export const awsProvider = new AwsProvider();
