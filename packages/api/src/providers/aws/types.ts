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
  assignPublicIp?: boolean;
  publicSshEnabled?: boolean;
  efsFileSystemId?: string;
  logGroupName?: string;
}

export interface AwsExternalServiceId {
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
