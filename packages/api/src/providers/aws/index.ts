import { createHash } from "node:crypto";
import {
  ECSClient,
  CreateClusterCommand,
  DescribeClustersCommand,
  RegisterTaskDefinitionCommand,
  type ContainerDefinition,
  type PortMapping,
  CreateServiceCommand,
  UpdateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
  ListTasksCommand,
  DescribeTasksCommand,
  DeregisterTaskDefinitionCommand,
  waitUntilServicesInactive,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  type AuthorizeSecurityGroupIngressCommandInput,
  AuthorizeSecurityGroupEgressCommand,
  type AuthorizeSecurityGroupEgressCommandInput,
  DescribeNetworkInterfacesCommand,
} from "@aws-sdk/client-ec2";
import {
  ElasticLoadBalancingV2Client,
  CreateLoadBalancerCommand,
  DescribeLoadBalancersCommand,
  CreateTargetGroupCommand,
  DescribeTargetGroupsCommand,
  CreateListenerCommand,
  DescribeListenersCommand,
  DeleteListenerCommand,
  DeleteTargetGroupCommand,
  DeleteLoadBalancerCommand,
  waitUntilLoadBalancerAvailable,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  EFSClient,
  CreateFileSystemCommand,
  DescribeFileSystemsCommand,
  CreateMountTargetCommand,
  DescribeMountTargetsCommand,
  DeleteMountTargetCommand,
  DeleteFileSystemCommand,
} from "@aws-sdk/client-efs";
import env from "@gitterm/env/server";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import { getProviderConfigService } from "../../service/config/provider-config";
import type { AwsConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;

const DEFAULT_PORT = 7681;
const CLUSTER_NAME = "gitterm-workspaces";
const TASK_CONTAINER_NAME = "workspace";
const DEFAULT_CPU = "1024";
const DEFAULT_MEMORY = "2048";
const DEFAULT_PUBLIC_INGRESS = false;
const SECURITY_GROUP_ALB = "gitterm-workspaces-alb";
const SECURITY_GROUP_TASKS = "gitterm-workspaces-tasks";
const SECURITY_GROUP_EFS = "gitterm-workspaces-efs";

type AwsClients = {
  ecs: ECSClient;
  ec2: EC2Client;
  elb: ElasticLoadBalancingV2Client;
  efs: EFSClient;
};

type NetworkConfig = {
  vpcId: string;
  vpcCidr: string;
  subnetIds: string[];
  albSecurityGroupId: string;
  tasksSecurityGroupId: string;
  efsSecurityGroupId: string;
};

function buildWorkspaceDomain(subdomain: string): string {
  if (ROUTING_MODE === "path") {
    return BASE_DOMAIN.includes("localhost")
      ? `http://${BASE_DOMAIN}/ws/${subdomain}`
      : `https://${BASE_DOMAIN}/ws/${subdomain}`;
  }

  return BASE_DOMAIN.includes("localhost")
    ? `http://${subdomain}.${BASE_DOMAIN}`
    : `https://${subdomain}.${BASE_DOMAIN}`;
}

function getShortId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function getServiceName(shortId: string): string {
  return `gitterm-ws-${shortId}`;
}

function getTaskDefinitionFamily(shortId: string): string {
  return `gitterm-ws-${shortId}`;
}

function getLoadBalancerName(shortId: string): string {
  return `gitterm-alb-${shortId}`;
}

function getTargetGroupName(shortId: string): string {
  return `gitterm-tg-${shortId}`;
}

export class AwsProvider implements ComputeProvider {
  readonly name = "aws";
  private config: AwsConfig | null = null;
  private networkCache = new Map<string, NetworkConfig>();

  async getConfig(): Promise<AwsConfig> {
    if (this.config) {
      return this.config;
    }

    const dbConfig = await getProviderConfigService().getProviderConfigForUse("aws");
    if (!dbConfig) {
      console.error("AWS provider is not configured.");
      throw new Error(
        "AWS provider is not configured. Please configure it in the admin panel.",
      );
    }

    this.config = dbConfig as AwsConfig;
    return this.config;
  }

  private getRegion(config: AwsConfig, regionIdentifier?: string, externalServiceId?: string): string {
    if (regionIdentifier) return regionIdentifier;

    const arnRegion = this.getRegionFromArn(externalServiceId);
    if (arnRegion) return arnRegion;

    return config.region;
  }

  private getRegionFromArn(externalServiceId?: string): string | null {
    if (!externalServiceId) return null;
    const parts = externalServiceId.split(":");
    if (parts.length >= 4 && parts[2] === "ecs") {
      return parts[3] ?? null;
    }
    return null;
  }

  private getClients(region: string, config: AwsConfig): AwsClients {
    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };

    return {
      ecs: new ECSClient({ region, credentials }),
      ec2: new EC2Client({ region, credentials }),
      elb: new ElasticLoadBalancingV2Client({ region, credentials }),
      efs: new EFSClient({ region, credentials }),
    };
  }

  private async ensureCluster(ecs: ECSClient): Promise<void> {
    const existing = await ecs.send(
      new DescribeClustersCommand({ clusters: [CLUSTER_NAME] }),
    );
    if (existing.clusters && existing.clusters.length > 0) {
      return;
    }

    await ecs.send(new CreateClusterCommand({ clusterName: CLUSTER_NAME }));
  }

  private async getDefaultVpc(ec2: EC2Client): Promise<{ vpcId: string; vpcCidr: string }> {
    const result = await ec2.send(
      new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }),
    );
    const vpc = result.Vpcs?.[0];
    if (!vpc?.VpcId) {
      throw new Error("No default VPC found for AWS provider");
    }
    if (!vpc.CidrBlock) {
      throw new Error("Default VPC CIDR not found for AWS provider");
    }
    return { vpcId: vpc.VpcId, vpcCidr: vpc.CidrBlock };
  }

  private async getPublicSubnetIds(ec2: EC2Client, vpcId: string): Promise<string[]> {
    const result = await ec2.send(
      new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }] }),
    );

    const subnets = (result.Subnets ?? []).filter((subnet) => subnet.MapPublicIpOnLaunch);
    const subnetIds = subnets
      .map((subnet) => subnet.SubnetId)
      .filter((id): id is string => Boolean(id));

    if (subnetIds.length === 0) {
      throw new Error("No public subnets found in default VPC");
    }

    return subnetIds;
  }

  private async getOrCreateSecurityGroup(
    ec2: EC2Client,
    vpcId: string,
    name: string,
    description: string,
  ): Promise<string> {
    const existing = await ec2.send(
      new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: "group-name", Values: [name] },
          { Name: "vpc-id", Values: [vpcId] },
        ],
      }),
    );

    const sgId = existing.SecurityGroups?.[0]?.GroupId;
    if (sgId) return sgId;

    const created = await ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: name,
        Description: description,
        VpcId: vpcId,
      }),
    );

    if (!created.GroupId) {
      throw new Error(`Failed to create security group: ${name}`);
    }

    return created.GroupId;
  }

  private async authorizeIngress(
    ec2: EC2Client,
    input: AuthorizeSecurityGroupIngressCommandInput,
  ): Promise<void> {
    try {
      await ec2.send(new AuthorizeSecurityGroupIngressCommand(input));
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name === "InvalidPermission.Duplicate") {
        return;
      }
      throw error;
    }
  }

  private async authorizeEgress(
    ec2: EC2Client,
    input: AuthorizeSecurityGroupEgressCommandInput,
  ): Promise<void> {
    try {
      await ec2.send(new AuthorizeSecurityGroupEgressCommand(input));
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name === "InvalidPermission.Duplicate") {
        return;
      }
      throw error;
    }
  }

  private async ensureSecurityGroupRules(
    ec2: EC2Client,
    albSecurityGroupId: string,
    tasksSecurityGroupId: string,
    efsSecurityGroupId: string,
  ): Promise<void> {
    await this.authorizeIngress(ec2, {
      GroupId: albSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 80,
          ToPort: 80,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
          Ipv6Ranges: [{ CidrIpv6: "::/0" }],
        },
        {
          IpProtocol: "tcp",
          FromPort: 443,
          ToPort: 443,
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
          Ipv6Ranges: [{ CidrIpv6: "::/0" }],
        },
      ],
    });

    await this.authorizeEgress(ec2, {
      GroupId: albSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: "-1",
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
          Ipv6Ranges: [{ CidrIpv6: "::/0" }],
        },
      ],
    });

    await this.authorizeIngress(ec2, {
      GroupId: tasksSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: DEFAULT_PORT,
          ToPort: DEFAULT_PORT,
          UserIdGroupPairs: [{ GroupId: albSecurityGroupId }],
        },
      ],
    });

    await this.authorizeEgress(ec2, {
      GroupId: tasksSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: "-1",
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
          Ipv6Ranges: [{ CidrIpv6: "::/0" }],
        },
      ],
    });

    await this.authorizeIngress(ec2, {
      GroupId: efsSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 2049,
          ToPort: 2049,
          UserIdGroupPairs: [{ GroupId: tasksSecurityGroupId }],
        },
      ],
    });

    await this.authorizeEgress(ec2, {
      GroupId: efsSecurityGroupId,
      IpPermissions: [
        {
          IpProtocol: "-1",
          IpRanges: [{ CidrIp: "0.0.0.0/0" }],
          Ipv6Ranges: [{ CidrIpv6: "::/0" }],
        },
      ],
    });
  }

  private async getNetworkConfig(region: string, config: AwsConfig): Promise<NetworkConfig> {
    const cached = this.networkCache.get(region);
    if (cached) return cached;

    const { ec2 } = this.getClients(region, config);
    const { vpcId, vpcCidr } = await this.getDefaultVpc(ec2);
    const subnetIds = await this.getPublicSubnetIds(ec2, vpcId);

    const albSecurityGroupId = await this.getOrCreateSecurityGroup(
      ec2,
      vpcId,
      SECURITY_GROUP_ALB,
      "Gitterm ALB security group",
    );
    const tasksSecurityGroupId = await this.getOrCreateSecurityGroup(
      ec2,
      vpcId,
      SECURITY_GROUP_TASKS,
      "Gitterm ECS task security group",
    );
    const efsSecurityGroupId = await this.getOrCreateSecurityGroup(
      ec2,
      vpcId,
      SECURITY_GROUP_EFS,
      "Gitterm EFS security group",
    );

    await this.ensureSecurityGroupRules(
      ec2,
      albSecurityGroupId,
      tasksSecurityGroupId,
      efsSecurityGroupId,
    );

    const network = {
      vpcId,
      vpcCidr,
      subnetIds,
      albSecurityGroupId,
      tasksSecurityGroupId,
      efsSecurityGroupId,
    };

    this.networkCache.set(region, network);
    return network;
  }

  private async ensureLoadBalancer(
    elb: ElasticLoadBalancingV2Client,
    name: string,
    subnetIds: string[],
    securityGroupId: string,
    publicIngress: boolean,
  ) {
    try {
      const existing = await elb.send(new DescribeLoadBalancersCommand({ Names: [name] }));
      const lb = existing.LoadBalancers?.[0];
      if (lb) return lb;
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name !== "LoadBalancerNotFoundException") {
        throw error;
      }
    }

    const created = await elb.send(
      new CreateLoadBalancerCommand({
        Name: name,
        Subnets: subnetIds,
        SecurityGroups: [securityGroupId],
        Scheme: publicIngress ? "internet-facing" : "internal",
        Type: "application",
        IpAddressType: "ipv4",
        Tags: [{ Key: "gitterm:service", Value: "workspace" }],
      }),
    );

    const lb = created.LoadBalancers?.[0];
    if (!lb?.LoadBalancerArn) {
      throw new Error("Failed to create load balancer");
    }

    await waitUntilLoadBalancerAvailable(
      { client: elb, maxWaitTime: 120 },
      { LoadBalancerArns: [lb.LoadBalancerArn] },
    );

    return lb;
  }

  private async ensureTargetGroup(
    elb: ElasticLoadBalancingV2Client,
    name: string,
    vpcId: string,
    port: number,
  ) {
    try {
      const existing = await elb.send(new DescribeTargetGroupsCommand({ Names: [name] }));
      const tg = existing.TargetGroups?.[0];
      if (tg) return tg;
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name !== "TargetGroupNotFoundException") {
        throw error;
      }
    }

    const created = await elb.send(
      new CreateTargetGroupCommand({
        Name: name,
        Port: port,
        Protocol: "HTTP",
        TargetType: "ip",
        VpcId: vpcId,
        HealthCheckPath: "/health",
        HealthCheckProtocol: "HTTP",
      }),
    );

    const tg = created.TargetGroups?.[0];
    if (!tg?.TargetGroupArn) {
      throw new Error("Failed to create target group");
    }

    return tg;
  }

  private async ensureListener(
    elb: ElasticLoadBalancingV2Client,
    loadBalancerArn: string,
    targetGroupArn: string,
  ) {
    const listeners = await elb.send(
      new DescribeListenersCommand({ LoadBalancerArn: loadBalancerArn }),
    );
    const existing = listeners.Listeners?.find((listener) => listener.Port === 80);
    if (existing) return existing;

    const created = await elb.send(
      new CreateListenerCommand({
        LoadBalancerArn: loadBalancerArn,
        Port: 80,
        Protocol: "HTTP",
        DefaultActions: [{ Type: "forward", TargetGroupArn: targetGroupArn }],
      }),
    );

    return created.Listeners?.[0];
  }

  private async registerTaskDefinition(
    ecs: ECSClient,
    family: string,
    config: WorkspaceConfig,
    efsFileSystemId?: string,
  ): Promise<string> {
    const environment = Object.entries(config.environmentVariables ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => ({ name, value: String(value) }));

    const portMappings: PortMapping[] = [
      {
        containerPort: DEFAULT_PORT,
        protocol: "tcp",
      },
    ];

    const containerDefinition: ContainerDefinition = {
      name: TASK_CONTAINER_NAME,
      image: config.imageId,
      essential: true,
      portMappings,
      environment,
      ...(efsFileSystemId
        ? {
            mountPoints: [
              {
                sourceVolume: "workspace",
                containerPath: "/workspace",
                readOnly: false,
              },
            ],
          }
        : {}),
    };

    const taskDefinition = await ecs.send(
      new RegisterTaskDefinitionCommand({
        family,
        networkMode: "awsvpc",
        requiresCompatibilities: ["FARGATE"],
        cpu: DEFAULT_CPU,
        memory: DEFAULT_MEMORY,
        containerDefinitions: [containerDefinition],
        volumes: efsFileSystemId
          ? [
              {
                name: "workspace",
                efsVolumeConfiguration: {
                  fileSystemId: efsFileSystemId,
                  transitEncryption: "ENABLED",
                },
              },
            ]
          : undefined,
      }),
    );

    const taskDefinitionArn = taskDefinition.taskDefinition?.taskDefinitionArn;
    if (!taskDefinitionArn) {
      throw new Error("Failed to register task definition");
    }

    return taskDefinitionArn;
  }

  private async createService(
    ecs: ECSClient,
    region: string,
    network: NetworkConfig,
    config: WorkspaceConfig,
    targetGroupArn: string,
    taskDefinitionArn: string,
    publicIngress: boolean,
  ) {
    const serviceName = getServiceName(getShortId(config.workspaceId));
    return ecs.send(
      new CreateServiceCommand({
        cluster: CLUSTER_NAME,
        serviceName,
        taskDefinition: taskDefinitionArn,
        desiredCount: 1,
        launchType: "FARGATE",
        deploymentConfiguration: {
          minimumHealthyPercent: 0,
          maximumPercent: 200,
        },
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: network.subnetIds,
            securityGroups: [network.tasksSecurityGroupId],
            assignPublicIp: publicIngress ? "ENABLED" : "DISABLED",
          },
        },
        loadBalancers: targetGroupArn
          ? [
              {
                targetGroupArn,
                containerName: TASK_CONTAINER_NAME,
                containerPort: DEFAULT_PORT,
              },
            ]
          : undefined,
        enableExecuteCommand: false,
        tags: [
          { key: "gitterm:workspace", value: config.workspaceId },
          { key: "gitterm:region", value: region },
        ],
      }),
    );
  }

  private getServiceNameFromExternalId(externalServiceId: string): string {
    const parts = externalServiceId.split("/");
    return parts[parts.length - 1] || externalServiceId;
  }

  private async getLoadBalancerDns(
    elb: ElasticLoadBalancingV2Client,
    serviceName: string,
  ): Promise<string | null> {
    const shortId = serviceName.replace("gitterm-ws-", "");
    const lbName = getLoadBalancerName(shortId);
    try {
      const result = await elb.send(new DescribeLoadBalancersCommand({ Names: [lbName] }));
      const lb = result.LoadBalancers?.[0];
      return lb?.DNSName ?? null;
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name === "LoadBalancerNotFoundException") {
        return null;
      }
      throw error;
    }
  }

  private async getTaskPublicIp(
    ecs: ECSClient,
    ec2: EC2Client,
    serviceName: string,
  ): Promise<string | null> {
    const tasks = await ecs.send(
      new ListTasksCommand({
        cluster: CLUSTER_NAME,
        serviceName,
        desiredStatus: "RUNNING",
      }),
    );

    const taskArn = tasks.taskArns?.[0];
    if (!taskArn) return null;

    const described = await ecs.send(
      new DescribeTasksCommand({ cluster: CLUSTER_NAME, tasks: [taskArn] }),
    );
    const task = described.tasks?.[0];
    const attachment = task?.attachments?.find((item) => item.type === "ElasticNetworkInterface");
    const eniId = attachment?.details?.find((detail) => detail.name === "networkInterfaceId")?.value;
    if (!eniId) return null;

    const eni = await ec2.send(
      new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
    );
    return eni.NetworkInterfaces?.[0]?.Association?.PublicIp ?? null;
  }

  private async getTaskPrivateIp(
    ecs: ECSClient,
    ec2: EC2Client,
    serviceName: string,
  ): Promise<string | null> {
    const tasks = await ecs.send(
      new ListTasksCommand({
        cluster: CLUSTER_NAME,
        serviceName,
        desiredStatus: "RUNNING",
      }),
    );

    const taskArn = tasks.taskArns?.[0];
    if (!taskArn) return null;

    const described = await ecs.send(
      new DescribeTasksCommand({ cluster: CLUSTER_NAME, tasks: [taskArn] }),
    );
    const task = described.tasks?.[0];
    const attachment = task?.attachments?.find((item) => item.type === "ElasticNetworkInterface");
    const eniId = attachment?.details?.find((detail) => detail.name === "networkInterfaceId")?.value;
    if (!eniId) return null;

    const eni = await ec2.send(
      new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
    );
    return eni.NetworkInterfaces?.[0]?.PrivateIpAddress ?? null;
  }

  private async authorizePortIngress(
    ec2: EC2Client,
    securityGroupId: string,
    port: number,
    publicIngress: boolean,
    vpcCidr: string,
  ): Promise<void> {
    const ipPermissions = publicIngress
      ? [
          {
            IpProtocol: "tcp",
            FromPort: port,
            ToPort: port,
            IpRanges: [{ CidrIp: "0.0.0.0/0" }],
            Ipv6Ranges: [{ CidrIpv6: "::/0" }],
          },
        ]
      : [
          {
            IpProtocol: "tcp",
            FromPort: port,
            ToPort: port,
            IpRanges: [{ CidrIp: vpcCidr }],
          },
        ];

    await this.authorizeIngress(ec2, {
      GroupId: securityGroupId,
      IpPermissions: ipPermissions,
    });
  }

  private async createFileSystem(
    efs: EFSClient,
    workspaceId: string,
  ): Promise<string> {
    const shortId = getShortId(workspaceId);
    const token = `gitterm-${shortId}`;

    const existing = await efs.send(
      new DescribeFileSystemsCommand({ CreationToken: token }),
    );
    const existingFs = existing.FileSystems?.[0];
    if (existingFs?.FileSystemId) {
      return existingFs.FileSystemId;
    }

    const created = await efs.send(
      new CreateFileSystemCommand({
        CreationToken: token,
        Encrypted: true,
        Tags: [
          { Key: "Name", Value: `gitterm-efs-${shortId}` },
          { Key: "gitterm:workspace", Value: workspaceId },
        ],
      }),
    );

    if (!created.FileSystemId) {
      throw new Error("Failed to create EFS file system");
    }

    return created.FileSystemId;
  }

  private async ensureMountTargets(
    efs: EFSClient,
    fileSystemId: string,
    subnetIds: string[],
    securityGroupId: string,
  ): Promise<void> {
    const mounts = await efs.send(
      new DescribeMountTargetsCommand({ FileSystemId: fileSystemId }),
    );
    const existing = new Set(
      (mounts.MountTargets ?? [])
        .map((target) => target.SubnetId)
        .filter((id): id is string => Boolean(id)),
    );

    for (const subnetId of subnetIds) {
      if (existing.has(subnetId)) continue;
      await efs.send(
        new CreateMountTargetCommand({
          FileSystemId: fileSystemId,
          SubnetId: subnetId,
          SecurityGroups: [securityGroupId],
        }),
      );
    }
  }

  private async cleanupFailedWorkspace(
    clients: AwsClients,
    serviceArn?: string,
    taskDefinitionArn?: string,
    loadBalancerArn?: string,
    targetGroupArn?: string,
  ): Promise<void> {
    const { ecs, elb } = clients;

    if (serviceArn) {
      try {
        await ecs.send(
          new DeleteServiceCommand({
            cluster: CLUSTER_NAME,
            service: serviceArn,
            force: true,
          }),
        );
      } catch (error) {
        console.warn("Failed to cleanup ECS service:", error);
      }
    }

    if (taskDefinitionArn) {
      try {
        await ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefinitionArn }));
      } catch (error) {
        console.warn("Failed to cleanup task definition:", error);
      }
    }

    if (loadBalancerArn) {
      try {
        const listeners = await elb.send(
          new DescribeListenersCommand({ LoadBalancerArn: loadBalancerArn }),
        );
        for (const listener of listeners.Listeners ?? []) {
          if (!listener.ListenerArn) continue;
          await elb.send(new DeleteListenerCommand({ ListenerArn: listener.ListenerArn }));
        }
      } catch (error) {
        console.warn("Failed to cleanup load balancer listeners:", error);
      }
    }

    if (loadBalancerArn) {
      try {
        await elb.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: loadBalancerArn }));
      } catch (error) {
        console.warn("Failed to cleanup load balancer:", error);
      }
    }

    if (targetGroupArn) {
      try {
        await elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }));
      } catch (error) {
        console.warn("Failed to cleanup target group:", error);
      }
    }
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, config.regionIdentifier);
    const clients = this.getClients(region, awsConfig);
    const { ecs, elb } = clients;
    const publicIngress = awsConfig.publicIngress ?? DEFAULT_PUBLIC_INGRESS;
    const network = await this.getNetworkConfig(region, awsConfig);

    await this.ensureCluster(ecs);

    const shortId = getShortId(config.workspaceId);
    const serviceName = getServiceName(shortId);
    const lbName = getLoadBalancerName(shortId);
    const tgName = getTargetGroupName(shortId);

    let serviceArn: string | undefined;
    let taskDefinitionArn: string | undefined;
    let loadBalancerArn: string | undefined;
    let targetGroupArn: string | undefined;

    try {
      const loadBalancer = await this.ensureLoadBalancer(
        elb,
        lbName,
        network.subnetIds,
        network.albSecurityGroupId,
        publicIngress,
      );
      loadBalancerArn = loadBalancer.LoadBalancerArn;

      const targetGroup = await this.ensureTargetGroup(
        elb,
        tgName,
        network.vpcId,
        DEFAULT_PORT,
      );
      targetGroupArn = targetGroup.TargetGroupArn;

      if (!loadBalancer.LoadBalancerArn || !targetGroupArn) {
        throw new Error("Failed to create load balancer resources");
      }

      await this.ensureListener(elb, loadBalancer.LoadBalancerArn, targetGroupArn);

      taskDefinitionArn = await this.registerTaskDefinition(
        ecs,
        getTaskDefinitionFamily(shortId),
        config,
      );

      const service = await this.createService(
        ecs,
        region,
        network,
        config,
        targetGroupArn,
        taskDefinitionArn,
        publicIngress,
      );

      serviceArn = service.service?.serviceArn;
      if (!serviceArn) {
        throw new Error("Failed to create ECS service");
      }

      const upstreamUrl = loadBalancer.DNSName
        ? `http://${loadBalancer.DNSName}`
        : "";

      return {
        externalServiceId: serviceArn,
        upstreamUrl,
        domain: buildWorkspaceDomain(config.subdomain),
        serviceCreatedAt: new Date(service.service?.createdAt ?? new Date()),
      };
    } catch (error) {
      await this.cleanupFailedWorkspace(
        clients,
        serviceArn,
        taskDefinitionArn,
        loadBalancerArn,
        targetGroupArn,
      );
      throw error;
    }
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, config.regionIdentifier);
    const clients = this.getClients(region, awsConfig);
    const { ecs, efs, elb } = clients;
    const publicIngress = awsConfig.publicIngress ?? DEFAULT_PUBLIC_INGRESS;
    const network = await this.getNetworkConfig(region, awsConfig);

    await this.ensureCluster(ecs);

    const shortId = getShortId(config.workspaceId);
    const serviceName = getServiceName(shortId);
    const lbName = getLoadBalancerName(shortId);
    const tgName = getTargetGroupName(shortId);

    let serviceArn: string | undefined;
    let taskDefinitionArn: string | undefined;
    let loadBalancerArn: string | undefined;
    let targetGroupArn: string | undefined;
    let fileSystemId: string | undefined;

    try {
      fileSystemId = await this.createFileSystem(efs, config.workspaceId);
      await this.ensureMountTargets(
        efs,
        fileSystemId,
        network.subnetIds,
        network.efsSecurityGroupId,
      );

      const loadBalancer = await this.ensureLoadBalancer(
        elb,
        lbName,
        network.subnetIds,
        network.albSecurityGroupId,
        publicIngress,
      );
      loadBalancerArn = loadBalancer.LoadBalancerArn;

      const targetGroup = await this.ensureTargetGroup(
        elb,
        tgName,
        network.vpcId,
        DEFAULT_PORT,
      );
      targetGroupArn = targetGroup.TargetGroupArn;

      if (!loadBalancer.LoadBalancerArn || !targetGroupArn) {
        throw new Error("Failed to create load balancer resources");
      }

      await this.ensureListener(elb, loadBalancer.LoadBalancerArn, targetGroupArn);

      taskDefinitionArn = await this.registerTaskDefinition(
        ecs,
        getTaskDefinitionFamily(shortId),
        config,
        fileSystemId,
      );

      const service = await this.createService(
        ecs,
        region,
        network,
        config,
        targetGroupArn,
        taskDefinitionArn,
        publicIngress,
      );

      serviceArn = service.service?.serviceArn;
      if (!serviceArn) {
        throw new Error("Failed to create ECS service");
      }

      const upstreamUrl = loadBalancer.DNSName
        ? `http://${loadBalancer.DNSName}`
        : "";

      return {
        externalServiceId: serviceArn,
        externalVolumeId: fileSystemId,
        upstreamUrl,
        domain: buildWorkspaceDomain(config.subdomain),
        serviceCreatedAt: new Date(service.service?.createdAt ?? new Date()),
        volumeCreatedAt: new Date(),
      };
    } catch (error) {
      await this.cleanupFailedWorkspace(
        clients,
        serviceArn,
        taskDefinitionArn,
        loadBalancerArn,
        targetGroupArn,
      );
      throw error;
    }
  }

  async stopWorkspace(
    externalId: string,
    regionIdentifier: string,
  ): Promise<void> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, regionIdentifier, externalId);
    const { ecs } = this.getClients(region, awsConfig);

    await ecs.send(
      new UpdateServiceCommand({
        cluster: CLUSTER_NAME,
        service: externalId,
        desiredCount: 0,
      }),
    );
  }

  async restartWorkspace(
    externalId: string,
    regionIdentifier: string,
  ): Promise<void> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, regionIdentifier, externalId);
    const { ecs } = this.getClients(region, awsConfig);

    await ecs.send(
      new UpdateServiceCommand({
        cluster: CLUSTER_NAME,
        service: externalId,
        desiredCount: 1,
      }),
    );
  }

  async terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, undefined, externalServiceId);
    const clients = this.getClients(region, awsConfig);
    const { ecs, elb, efs } = clients;

    const serviceName = this.getServiceNameFromExternalId(externalServiceId);
    const shortId = serviceName.replace("gitterm-ws-", "");
    const lbName = getLoadBalancerName(shortId);
    const tgName = getTargetGroupName(shortId);

    const service = await ecs.send(
      new DescribeServicesCommand({
        cluster: CLUSTER_NAME,
        services: [externalServiceId],
      }),
    );

    const taskDefinitionArn = service.services?.[0]?.taskDefinition;

    await ecs.send(
      new DeleteServiceCommand({
        cluster: CLUSTER_NAME,
        service: externalServiceId,
        force: true,
      }),
    );

    await waitUntilServicesInactive(
      { client: ecs, maxWaitTime: 120 },
      { cluster: CLUSTER_NAME, services: [externalServiceId] },
    );

    if (taskDefinitionArn) {
      await ecs.send(
        new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefinitionArn }),
      );
    }

    try {
      const lb = await elb.send(new DescribeLoadBalancersCommand({ Names: [lbName] }));
      const lbArn = lb.LoadBalancers?.[0]?.LoadBalancerArn;
      if (lbArn) {
        const listeners = await elb.send(new DescribeListenersCommand({ LoadBalancerArn: lbArn }));
        for (const listener of listeners.Listeners ?? []) {
          if (!listener.ListenerArn) continue;
          await elb.send(new DeleteListenerCommand({ ListenerArn: listener.ListenerArn }));
        }

        await elb.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: lbArn }));
      }
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name !== "LoadBalancerNotFoundException") {
        throw error;
      }
    }

    try {
      const tg = await elb.send(new DescribeTargetGroupsCommand({ Names: [tgName] }));
      const tgArn = tg.TargetGroups?.[0]?.TargetGroupArn;
      if (tgArn) {
        await elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: tgArn }));
      }
    } catch (error) {
      const err = error as { name?: string };
      if (err?.name !== "TargetGroupNotFoundException") {
        throw error;
      }
    }

    if (externalVolumeId) {
      try {
        const mounts = await efs.send(
          new DescribeMountTargetsCommand({ FileSystemId: externalVolumeId }),
        );

        for (const mount of mounts.MountTargets ?? []) {
          if (!mount.MountTargetId) continue;
          await efs.send(new DeleteMountTargetCommand({ MountTargetId: mount.MountTargetId }));
        }

        await efs.send(new DeleteFileSystemCommand({ FileSystemId: externalVolumeId }));
      } catch (error) {
        console.warn("Failed to cleanup EFS volume:", error);
      }
    }
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, undefined, externalId);
    const { ecs } = this.getClients(region, awsConfig);

    const result = await ecs.send(
      new DescribeServicesCommand({ cluster: CLUSTER_NAME, services: [externalId] }),
    );

    const service = result.services?.[0];
    if (!service) {
      return { status: "terminated" };
    }

    if (service.desiredCount === 0) {
      return { status: "stopped" };
    }

    if ((service.runningCount ?? 0) > 0) {
      return { status: "running" };
    }

    return { status: "pending" };
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string }> {
    const awsConfig = await this.getConfig();
    const region = this.getRegion(awsConfig, undefined, externalServiceId);
    const { ecs, ec2, elb } = this.getClients(region, awsConfig);
    const publicIngress = awsConfig.publicIngress ?? DEFAULT_PUBLIC_INGRESS;
    const network = await this.getNetworkConfig(region, awsConfig);

    const serviceName = this.getServiceNameFromExternalId(externalServiceId);

    if (port === DEFAULT_PORT) {
      const dns = await this.getLoadBalancerDns(elb, serviceName);
      if (!dns) {
        throw new Error("Load balancer not found for service");
      }
      return { domain: `http://${dns}` };
    }

    await this.authorizePortIngress(
      ec2,
      network.tasksSecurityGroupId,
      port,
      publicIngress,
      network.vpcCidr,
    );

    if (publicIngress) {
      const publicIp = await this.getTaskPublicIp(ecs, ec2, serviceName);
      if (!publicIp) {
        throw new Error("No running task found for workspace");
      }
      return { domain: `http://${publicIp}:${port}` };
    }

    const privateIp = await this.getTaskPrivateIp(ecs, ec2, serviceName);
    if (!privateIp) {
      throw new Error("No running task found for workspace");
    }

    return { domain: `http://${privateIp}:${port}` };
  }

  async removeExposedPortDomain(): Promise<void> {
    return;
  }
}

export const awsProvider = new AwsProvider();
