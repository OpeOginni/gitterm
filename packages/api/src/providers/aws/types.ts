import type { AwsAccessProfile } from "@gitterm/schema";

export interface AwsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  defaultRegion: string;
  clusterArn: string;
  vpcId: string;
  subnetIds: string;
  securityGroupIds: string;
  albListenerArn: string;
  albBaseUrl: string;
  taskExecutionRoleArn: string;
  taskRoleArn: string;
  accessProfiles?: AwsAccessProfile[];
  assignPublicIp?: boolean;
  publicSshEnabled?: boolean;
  efsFileSystemId?: string;
  logGroupName?: string;
}

export interface AwsExternalServiceId {
  providerId?: string;
  runtimeSecretArn?: string;
  workspaceId: string;
  region: string;
  clusterArn: string;
  serviceArn: string;
  serviceName: string;
  taskDefinitionArn: string;
  targetGroupArn: string;
  listenerRuleArn: string;
  workspaceHost: string;
}

export interface AwsExternalPortDomainId {
  region: string;
  listenerRuleArn: string;
  targetGroupArn: string;
  workspaceHost: string;
}

/** A resource the orphan sweep tried to delete and could not; the next sweep retries it. */
export interface AwsCleanupFailure {
  resource: string;
  reason: string;
}

export interface AwsOrphanSweepResult {
  runtimeSecretsDeleted: number;
  servicesDeleted: number;
  taskDefinitionsDeregistered: number;
  rulesDeleted: number;
  targetGroupsDeleted: number;
  accessPointsDeleted: number;
  failures: AwsCleanupFailure[];
}
