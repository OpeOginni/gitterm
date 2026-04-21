import {
  CreateServiceCommand,
  DeleteServiceCommand,
  DeregisterTaskDefinitionCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ECSClient,
  ListServicesCommand,
  ListTagsForResourceCommand,
  ListTasksCommand,
  ListTaskDefinitionsCommand,
  RegisterTaskDefinitionCommand,
  TagResourceCommand as EcsTagResourceCommand,
  UpdateServiceCommand,
  type ContainerDefinition,
} from "@aws-sdk/client-ecs";
import {
  AddTagsCommand,
  CreateRuleCommand,
  CreateTargetGroupCommand,
  DeleteRuleCommand,
  DescribeTagsCommand,
  DescribeTargetGroupsCommand,
  DeleteTargetGroupCommand,
  DeregisterTargetsCommand,
  DescribeRulesCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  ModifyTargetGroupAttributesCommand,
  RegisterTargetsCommand,
  type Rule,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  CreateAccessPointCommand,
  DescribeAccessPointsCommand,
  DeleteAccessPointCommand,
  EFSClient,
  TagResourceCommand,
} from "@aws-sdk/client-efs";
import { DescribeNetworkInterfacesCommand, EC2Client } from "@aws-sdk/client-ec2";
import env from "@gitterm/env/server";
import type { AwsImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { getProviderConfigService } from "../../service/config/provider-config";
import { logger } from "../../utils/logger";
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
const TARGET_GROUP_DEREGISTRATION_DELAY_SECONDS = 5;
const SERVICE_STABILIZATION_TIMEOUT_MS = 3 * 60 * 1000;
const SERVICE_POLL_INTERVAL_MS = 5000;
const AWS_ROUTING_HEADER = "X-GitTerm-Aws-Routing-Key";
const AWS_MANAGED_BY_TAG = "gitterm";
const AWS_SERVICE_NAME_PREFIX = "gitterm-";
const AWS_TASK_FAMILY_PREFIX = "gitterm-workspace-";
const AWS_TARGET_GROUP_NAME_PREFIX = "gtm-";

type WorkspaceTag = { key: string; value: string };

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

function buildWorkspaceTags(
  workspaceId: string,
  resourceKind: string,
  extra: Record<string, string> = {},
): WorkspaceTag[] {
  return [
    { key: "ManagedBy", value: AWS_MANAGED_BY_TAG },
    { key: "WorkspaceId", value: workspaceId },
    { key: "ResourceKind", value: resourceKind },
    ...Object.entries(extra).map(([key, value]) => ({ key, value })),
  ];
}

function getTagValue(
  tags:
    | Array<{ Key?: string; Value?: string }>
    | Array<{ key?: string; value?: string }>
    | undefined,
  key: string,
): string | null {
  for (const tag of tags ?? []) {
    if ("Key" in tag && tag.Key === key) {
      return tag.Value ?? null;
    }

    if ("key" in tag && tag.key === key) {
      return tag.value ?? null;
    }
  }

  return null;
}

function isManagedWorkspaceResource(
  tags:
    | Array<{ Key?: string; Value?: string }>
    | Array<{ key?: string; value?: string }>
    | undefined,
  activeWorkspaceIds: Set<string>,
): boolean {
  const managedBy = getTagValue(tags, "ManagedBy");
  const workspaceId = getTagValue(tags, "WorkspaceId");
  return managedBy === AWS_MANAGED_BY_TAG && !!workspaceId && !activeWorkspaceIds.has(workspaceId);
}

function isGitTermServiceArn(serviceArn: string): boolean {
  return serviceArn.includes(`/${AWS_SERVICE_NAME_PREFIX}`);
}

function isGitTermTaskDefinitionArn(taskDefinitionArn: string): boolean {
  return taskDefinitionArn.includes(`task-definition/${AWS_TASK_FAMILY_PREFIX}`);
}

function isGitTermTargetGroupArn(targetGroupArn: string): boolean {
  return targetGroupArn.includes(`targetgroup/${AWS_TARGET_GROUP_NAME_PREFIX}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function matchesAwsError(error: unknown, ...needles: string[]): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const awsError = error as {
    name?: string;
    __type?: string;
    Code?: string;
    code?: string;
    message?: string;
    Message?: string;
  };

  const haystacks = [
    awsError.name,
    awsError.__type,
    awsError.Code,
    awsError.code,
    awsError.message,
    awsError.Message,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());

  return needles.some((needle) => haystacks.some((haystack) => haystack.includes(needle.toLowerCase())));
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

  private async tagLoadBalancerResources(
    resourceArns: string[],
    tags: WorkspaceTag[],
    region?: string,
  ): Promise<void> {
    if (resourceArns.length === 0) {
      return;
    }

    const { elbv2 } = await this.createClients(region);
    await elbv2.send(
      new AddTagsCommand({
        ResourceArns: resourceArns,
        Tags: tags.map((tag) => ({ Key: tag.key, Value: tag.value })),
      }),
    );
  }

  private async tagEfsResource(
    resourceArn: string,
    tags: WorkspaceTag[],
    region?: string,
  ): Promise<void> {
    const { efs } = await this.createClients(region);
    await efs.send(
      new TagResourceCommand({
        ResourceId: resourceArn,
        Tags: tags.map((tag) => ({ Key: tag.key, Value: tag.value })),
      }),
    );
  }

  private async tagEcsResource(
    resourceArn: string,
    tags: WorkspaceTag[],
    region?: string,
  ): Promise<void> {
    const { ecs } = await this.createClients(region);
    await ecs.send(
      new EcsTagResourceCommand({
        resourceArn,
        tags: tags.map((tag) => ({ key: tag.key, value: tag.value })),
      }),
    );
  }

  private getMainContainerPort(config: WorkspaceConfig): number {
    return getImageMetadata(config).containerPort ?? DEFAULT_MAIN_PORT;
  }

  private getHealthCheckPath(config: WorkspaceConfig): string {
    return getImageMetadata(config).healthCheckPath ?? DEFAULT_HEALTH_CHECK_PATH;
  }

  private getUpstreamAccessHeaders(routingValue: string): UpstreamAccess {
    return {
      headers: {
        [AWS_ROUTING_HEADER]: routingValue,
      },
    };
  }

  private async findRuleByRoutingValue(
    listenerArn: string,
    routingValue: string,
    region?: string,
  ): Promise<Rule | null> {
    const { elbv2 } = await this.createClients(region);
    const response = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));

    return (
      response.Rules?.find((rule) =>
        rule.Conditions?.some(
          (condition) =>
            condition.Field === "http-header" &&
            condition.HttpHeaderConfig?.HttpHeaderName?.toLowerCase() ===
              AWS_ROUTING_HEADER.toLowerCase() &&
            condition.HttpHeaderConfig?.Values?.includes(routingValue),
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

  private async waitForTargetGroupHealthy(targetGroupArn: string, region?: string): Promise<void> {
    const deadline = Date.now() + SERVICE_STABILIZATION_TIMEOUT_MS;
    let lastObservedState = "";

    while (Date.now() < deadline) {
      const { elbv2 } = await this.createClients(region);
      const response = await elbv2.send(
        new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }),
      );
      const targetDescriptions = response.TargetHealthDescriptions ?? [];
      const currentState = targetDescriptions
        .map(
          (description) =>
            `${description.Target?.Id ?? "unknown"}:${description.Target?.Port ?? "unknown"}=${description.TargetHealth?.State ?? "unknown"}`,
        )
        .join(", ");

      if (currentState && currentState !== lastObservedState) {
        logger.info("AWS target group health state observed", {
          provider: this.name,
          action: "create_workspace_target_health",
          region,
          error: currentState,
        });
        lastObservedState = currentState;
      }

      if (
        targetDescriptions.length > 0 &&
        targetDescriptions.every(
          (description) => description.TargetHealth?.State?.toLowerCase() === "healthy",
        )
      ) {
        return;
      }

      await sleep(SERVICE_POLL_INTERVAL_MS);
    }

    logger.error("AWS target group did not become healthy in time", {
      provider: this.name,
      action: "create_workspace_target_health_timeout",
      region,
      error: lastObservedState || "no target health observed",
    });
    throw new Error(`Timed out waiting for target group ${targetGroupArn} to become healthy`);
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

  private async configureTargetGroup(targetGroupArn: string, region?: string): Promise<void> {
    const { elbv2 } = await this.createClients(region);
    await elbv2.send(
      new ModifyTargetGroupAttributesCommand({
        TargetGroupArn: targetGroupArn,
        Attributes: [
          {
            Key: "deregistration_delay.timeout_seconds",
            Value: String(TARGET_GROUP_DEREGISTRATION_DELAY_SECONDS),
          },
        ],
      }),
    );
  }

  private async deleteRuleIfExists(ruleArn: string, region?: string): Promise<void> {
    const { elbv2 } = await this.createClients(region);

    await elbv2.send(new DeleteRuleCommand({ RuleArn: ruleArn })).catch((error) => {
      if (!matchesAwsError(error, "RuleNotFound", "not found")) {
        throw error;
      }
    });
  }

  private async deleteTargetGroupIfExists(targetGroupArn: string, region?: string): Promise<void> {
    const { elbv2 } = await this.createClients(region);

    await elbv2.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn })).catch((error) => {
      if (!matchesAwsError(error, "TargetGroupNotFound", "not found")) {
        throw error;
      }
    });
  }

  private async deleteAccessPointIfExists(accessPointId: string, region?: string): Promise<void> {
    const { efs } = await this.createClients(region);

    await efs.send(new DeleteAccessPointCommand({ AccessPointId: accessPointId })).catch((error) => {
      if (!matchesAwsError(error, "AccessPointNotFound", "not found")) {
        throw error;
      }
    });
  }

  private async registerTaskDefinition(
    config: WorkspaceConfig,
    region?: string,
    accessPointId?: string,
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

    const mountPoints = accessPointId
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
        volumes: accessPointId
          ? [
              {
                name: "workspace",
                efsVolumeConfiguration: {
                  fileSystemId: providerConfig.efsFileSystemId,
                  transitEncryption: "ENABLED",
                  authorizationConfig: {
                    accessPointId,
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

    await this.tagLoadBalancerResources(
      [targetGroupArn],
      buildWorkspaceTags(config.workspaceId, "workspace-target-group", {
        Subdomain: config.subdomain,
      }),
      region,
    );

    await this.configureTargetGroup(targetGroupArn, region);

    return targetGroupArn;
  }

  private async createListenerRule(
    listenerArn: string,
    routingValue: string,
    targetGroupArn: string,
    workspaceId: string,
    resourceKind: string,
    extraTags: Record<string, string> = {},
    region?: string,
  ): Promise<string> {
    const { elbv2 } = await this.createClients(region);
    const response = await elbv2.send(
      new CreateRuleCommand({
        ListenerArn: listenerArn,
        Priority: await this.allocateRulePriority(listenerArn, region),
        Conditions: [
          {
            Field: "http-header",
            HttpHeaderConfig: {
              HttpHeaderName: AWS_ROUTING_HEADER,
              Values: [routingValue],
            },
          },
        ],
        Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }],
      }),
    );
    const ruleArn = response.Rules?.[0]?.RuleArn;

    if (!ruleArn) {
      throw new Error(`Failed to create ALB listener rule for routing value ${routingValue}`);
    }

    await this.tagLoadBalancerResources(
      [ruleArn],
      buildWorkspaceTags(workspaceId, resourceKind, extraTags),
      region,
    );

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
    const accessPointId = response.AccessPointId;

    if (!accessPointId) {
      throw new Error(`Failed to create EFS access point for workspace ${config.workspaceId}`);
    }

    if (response.AccessPointArn) {
      await this.tagEfsResource(
        response.AccessPointArn,
        buildWorkspaceTags(config.workspaceId, "workspace-access-point", {
          Subdomain: config.subdomain,
        }),
        region,
      );
    }

    return accessPointId;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const providerRegion = config.regionIdentifier;
    const { ecs, config: providerConfig } = await this.createClients(providerRegion);
    const workspaceHost = buildWorkspaceHost(config.workspaceId);
    logger.info("AWS workspace provisioning started", {
      workspaceId: config.workspaceId,
      userId: config.userId,
      provider: this.name,
      region: providerRegion,
      action: persistent ? "create_persistent_workspace" : "create_workspace",
    });

    logger.info("AWS create main target group started", {
      workspaceId: config.workspaceId,
      provider: this.name,
      region: providerRegion,
      action: "create_target_group",
    });
    const targetGroupArn = await this.createMainTargetGroup(config, providerRegion);
    logger.info("AWS create main target group succeeded", {
      workspaceId: config.workspaceId,
      provider: this.name,
      region: providerRegion,
      action: "create_target_group",
      error: targetGroupArn,
    });
    let listenerRuleArn: string | undefined;
    let taskDefinitionArn: string | undefined;
    let serviceArn: string | undefined;
    let accessPointId: string | undefined;

    try {
      if (persistent) {
        logger.info("AWS create EFS access point started", {
          workspaceId: config.workspaceId,
          provider: this.name,
          region: providerRegion,
          action: "create_access_point",
        });
        accessPointId = await this.createEfsAccessPoint(config, providerRegion);
        logger.info("AWS create EFS access point succeeded", {
          workspaceId: config.workspaceId,
          provider: this.name,
          region: providerRegion,
          action: "create_access_point",
          error: accessPointId,
        });
      }

      logger.info("AWS register task definition started", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "register_task_definition",
      });
      taskDefinitionArn = await this.registerTaskDefinition(
        config,
        providerRegion,
        accessPointId,
      );
      await this.tagEcsResource(
        taskDefinitionArn,
        buildWorkspaceTags(config.workspaceId, "workspace-task-definition", {
          Subdomain: config.subdomain,
        }),
        providerRegion,
      );
      logger.info("AWS register task definition succeeded", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "register_task_definition",
        error: taskDefinitionArn,
      });

      logger.info("AWS create listener rule started", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "create_listener_rule",
      });
      listenerRuleArn = await this.createListenerRule(
        providerConfig.albListenerArn,
        workspaceHost,
        targetGroupArn,
        config.workspaceId,
        "workspace-rule",
        { Subdomain: config.subdomain },
        providerRegion,
      );
      logger.info("AWS create listener rule succeeded", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "create_listener_rule",
        error: listenerRuleArn,
      });

      logger.info("AWS create ECS service started", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "create_service",
      });
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
      if (serviceArn) {
        await this.tagEcsResource(
          serviceArn,
          buildWorkspaceTags(config.workspaceId, "workspace-service", {
            Subdomain: config.subdomain,
          }),
          providerRegion,
        );
      }
      logger.info("AWS create ECS service succeeded", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "create_service",
        error: serviceArn ?? "missing-service-arn",
      });

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

      logger.info("AWS wait for target group healthy started", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "wait_for_target_health",
        error: targetGroupArn,
      });
      await this.waitForTargetGroupHealthy(targetGroupArn, providerRegion);
      logger.info("AWS wait for target group healthy succeeded", {
        workspaceId: config.workspaceId,
        provider: this.name,
        region: providerRegion,
        action: "wait_for_target_health",
        error: targetGroupArn,
      });

      const upstreamUrl = trimTrailingSlash(providerConfig.albBaseUrl);
      const workspaceInfo: WorkspaceInfo = {
        externalServiceId: serializeExternalServiceId(externalId),
        upstreamUrl,
        upstreamAccess: this.getUpstreamAccessHeaders(workspaceHost),
        domain: buildDomain(config.subdomain),
        serviceCreatedAt: new Date(),
      };

      if (!persistent || !accessPointId) {
        return workspaceInfo;
      }

      return {
        ...workspaceInfo,
        externalVolumeId: accessPointId,
        volumeCreatedAt: new Date(),
      };
    } catch (error) {
      logger.error("AWS workspace provisioning failed", {
        workspaceId: config.workspaceId,
        userId: config.userId,
        provider: this.name,
        region: providerRegion,
        action: persistent ? "create_persistent_workspace" : "create_workspace",
        error: formatErrorMessage(error),
      });
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

      if (accessPointId) {
        await this.deleteAccessPointIfExists(accessPointId, providerRegion).catch(() => undefined);
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
    const targetRegion = regionIdentifier ?? handle.region;
    const { ecs } = await this.createClients(targetRegion);

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
    const targetRegion = regionIdentifier ?? handle.region;
    const { ecs } = await this.createClients(targetRegion);

    await ecs.send(
      new UpdateServiceCommand({
        cluster: handle.clusterArn,
        service: handle.serviceArn,
        desiredCount: 1,
      }),
    );
    await this.waitForTargetGroupHealthy(handle.targetGroupArn, targetRegion);
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
        if (!matchesAwsError(error, "ServiceNotFound", "ServiceNotFoundException", "not found")) {
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
    const rule = await this.findRuleByRoutingValue(
      config.albListenerArn,
      workspaceHost,
      handle.region,
    ).catch(
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

      await this.tagLoadBalancerResources(
        [targetGroupArn],
        buildWorkspaceTags(handle.workspaceId, "exposed-port-target-group", {
          Port: String(port),
        }),
        handle.region,
      );

      await this.configureTargetGroup(targetGroupArn, handle.region);
    }

    const taskIp = await this.resolveTaskIp(handle, handle.region);
    await this.refreshTargetGroupRegistration(targetGroupArn, taskIp, port, handle.region);

    if (!listenerRuleArn) {
      listenerRuleArn = await this.createListenerRule(
        config.albListenerArn,
        workspaceHost,
        targetGroupArn,
        handle.workspaceId,
        "exposed-port-rule",
        { Port: String(port) },
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

  async sweepOrphanedResources(activeWorkspaceIds: string[]): Promise<{
    servicesDeleted: number;
    taskDefinitionsDeregistered: number;
    rulesDeleted: number;
    targetGroupsDeleted: number;
    accessPointsDeleted: number;
  }> {
    const activeWorkspaceIdSet = new Set(activeWorkspaceIds);
    const { config, ecs, elbv2, efs } = await this.createClients();
    let servicesDeleted = 0;
    let taskDefinitionsDeregistered = 0;
    let rulesDeleted = 0;
    let targetGroupsDeleted = 0;
    let accessPointsDeleted = 0;

    const serviceArns: string[] = [];
    let serviceNextToken: string | undefined;
    do {
      const servicesResponse = await ecs.send(
        new ListServicesCommand({
          cluster: config.clusterArn,
          nextToken: serviceNextToken,
        }),
      );
      serviceArns.push(...(servicesResponse.serviceArns ?? []));
      serviceNextToken = servicesResponse.nextToken;
    } while (serviceNextToken);

    for (const serviceArn of serviceArns) {
      if (!isGitTermServiceArn(serviceArn)) {
        continue;
      }

      const tagResponse = await ecs.send(new ListTagsForResourceCommand({ resourceArn: serviceArn }));
      if (!isManagedWorkspaceResource(tagResponse.tags, activeWorkspaceIdSet)) {
        continue;
      }

      const serviceDescription = await ecs.send(
        new DescribeServicesCommand({
          cluster: config.clusterArn,
          services: [serviceArn],
        }),
      );
      const service = serviceDescription.services?.[0];

      await ecs
        .send(
          new DeleteServiceCommand({
            cluster: config.clusterArn,
            service: serviceArn,
            force: true,
          }),
        )
        .catch(() => undefined);
      servicesDeleted += 1;

      if (service?.taskDefinition) {
        if (!isGitTermTaskDefinitionArn(service.taskDefinition)) {
          continue;
        }

        await ecs
          .send(new DeregisterTaskDefinitionCommand({ taskDefinition: service.taskDefinition }))
          .catch(() => undefined);
        taskDefinitionsDeregistered += 1;
      }
    }

    const taskDefinitionArns: string[] = [];
    let taskDefinitionNextToken: string | undefined;
    do {
      const taskDefinitionsResponse = await ecs.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: "gitterm-workspace-",
          nextToken: taskDefinitionNextToken,
        }),
      );
      taskDefinitionArns.push(...(taskDefinitionsResponse.taskDefinitionArns ?? []));
      taskDefinitionNextToken = taskDefinitionsResponse.nextToken;
    } while (taskDefinitionNextToken);

    for (const taskDefinitionArn of taskDefinitionArns) {
      if (!isGitTermTaskDefinitionArn(taskDefinitionArn)) {
        continue;
      }

      const tagResponse = await ecs.send(
        new ListTagsForResourceCommand({ resourceArn: taskDefinitionArn }),
      );
      if (!isManagedWorkspaceResource(tagResponse.tags, activeWorkspaceIdSet)) {
        continue;
      }

      await ecs
        .send(new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefinitionArn }))
        .catch(() => undefined);
      taskDefinitionsDeregistered += 1;
    }

    const rulesResponse = await elbv2.send(
      new DescribeRulesCommand({ ListenerArn: config.albListenerArn }),
    );
    const taggedRuleArns = (rulesResponse.Rules ?? [])
      .filter((rule) => !rule.IsDefault && rule.RuleArn)
      .map((rule) => rule.RuleArn as string);

    for (const ruleArnBatch of chunk(taggedRuleArns, 20)) {
      const tagResponse = await elbv2.send(new DescribeTagsCommand({ ResourceArns: ruleArnBatch }));
      for (const description of tagResponse.TagDescriptions ?? []) {
        if (isManagedWorkspaceResource(description.Tags, activeWorkspaceIdSet) && description.ResourceArn) {
          await this.deleteRuleIfExists(description.ResourceArn).catch(() => undefined);
          rulesDeleted += 1;
        }
      }
    }

    const targetGroupArns: string[] = [];
    let targetGroupMarker: string | undefined;
    do {
      const targetGroupResponse = await elbv2.send(
        new DescribeTargetGroupsCommand({ Marker: targetGroupMarker }),
      );
      targetGroupArns.push(
        ...(targetGroupResponse.TargetGroups ?? [])
          .map((targetGroup) => targetGroup.TargetGroupArn)
          .filter((arn): arn is string => Boolean(arn)),
      );
      targetGroupMarker = targetGroupResponse.NextMarker;
    } while (targetGroupMarker);

    for (const targetGroupArnBatch of chunk(targetGroupArns, 20)) {
      const tagResponse = await elbv2.send(
        new DescribeTagsCommand({ ResourceArns: targetGroupArnBatch }),
      );
      for (const description of tagResponse.TagDescriptions ?? []) {
        if (
          description.ResourceArn &&
          isGitTermTargetGroupArn(description.ResourceArn) &&
          isManagedWorkspaceResource(description.Tags, activeWorkspaceIdSet)
        ) {
          await this.deleteTargetGroupIfExists(description.ResourceArn).catch(() => undefined);
          targetGroupsDeleted += 1;
        }
      }
    }

    if (config.efsFileSystemId) {
      let nextToken: string | undefined;
      do {
        const accessPointResponse = await efs.send(
          new DescribeAccessPointsCommand({
            FileSystemId: config.efsFileSystemId,
            NextToken: nextToken,
          }),
        );

        for (const accessPoint of accessPointResponse.AccessPoints ?? []) {
          const taggedWorkspaceId = getTagValue(
            (accessPoint as { Tags?: Array<{ Key?: string; Value?: string }> }).Tags,
            "WorkspaceId",
          );
          const pathWorkspaceId = accessPoint.RootDirectory?.Path?.startsWith("/gitterm/")
            ? accessPoint.RootDirectory.Path.replace("/gitterm/", "")
            : null;
          const workspaceId = taggedWorkspaceId ?? pathWorkspaceId;
          const isManaged =
            getTagValue(
              (accessPoint as { Tags?: Array<{ Key?: string; Value?: string }> }).Tags,
              "ManagedBy",
            ) === AWS_MANAGED_BY_TAG || Boolean(pathWorkspaceId);

          if (isManaged && workspaceId && !activeWorkspaceIdSet.has(workspaceId) && accessPoint.AccessPointId) {
            await this.deleteAccessPointIfExists(accessPoint.AccessPointId).catch(() => undefined);
            accessPointsDeleted += 1;
          }
        }

        nextToken = accessPointResponse.NextToken;
      } while (nextToken);
    }

    return {
      servicesDeleted,
      taskDefinitionsDeregistered,
      rulesDeleted,
      targetGroupsDeleted,
      accessPointsDeleted,
    };
  }
}

export const awsProvider = new AwsProvider();
