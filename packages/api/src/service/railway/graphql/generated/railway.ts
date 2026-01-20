export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  BigInt: { input: any; output: any; }
  CanvasConfig: { input: any; output: any; }
  DateTime: { input: any; output: any; }
  DeploymentMeta: { input: any; output: any; }
  DisplayConfig: { input: any; output: any; }
  EnvironmentConfig: { input: any; output: any; }
  EnvironmentVariables: { input: any; output: any; }
  JSON: { input: any; output: any; }
  NotificationPayload: { input: any; output: any; }
  RailpackInfo: { input: any; output: any; }
  SerializedTemplateConfig: { input: any; output: any; }
  ServiceInstanceLimit: { input: any; output: any; }
  SubscriptionPlanLimit: { input: any; output: any; }
  SupportHealthMetrics: { input: any; output: any; }
  TemplateConfig: { input: any; output: any; }
  TemplateMetadata: { input: any; output: any; }
  TemplateServiceConfig: { input: any; output: any; }
  TemplateVolume: { input: any; output: any; }
  Upload: { input: any; output: any; }
};

export type AccessRule = {
  __typename?: 'AccessRule';
  disallowed?: Maybe<Scalars['String']['output']>;
};

export enum ActiveFeatureFlag {
  AuditLogs = 'AUDIT_LOGS',
  BucketFileBrowser = 'BUCKET_FILE_BROWSER',
  ConversationalUi = 'CONVERSATIONAL_UI',
  LoginWithRailway = 'LOGIN_WITH_RAILWAY',
  MagicConfig = 'MAGIC_CONFIG',
  PostgresHa = 'POSTGRES_HA',
  PriorityBoarding = 'PRIORITY_BOARDING',
  RawSqlQueries = 'RAW_SQL_QUERIES'
}

export enum ActivePlatformFlag {
  AllowReplicaMetrics = 'ALLOW_REPLICA_METRICS',
  BuilderV3RolloutExistingServices = 'BUILDER_V3_ROLLOUT_EXISTING_SERVICES',
  BuilderV3RolloutExistingServicesPro = 'BUILDER_V3_ROLLOUT_EXISTING_SERVICES_PRO',
  BuilderV3RolloutNewServices = 'BUILDER_V3_ROLLOUT_NEW_SERVICES',
  BuilderV3RolloutNewServicesPro = 'BUILDER_V3_ROLLOUT_NEW_SERVICES_PRO',
  CompareClickhouseMetrics = 'COMPARE_CLICKHOUSE_METRICS',
  CtrdImageStoreRollout = 'CTRD_IMAGE_STORE_ROLLOUT',
  DemoPercentageRollout = 'DEMO_PERCENTAGE_ROLLOUT',
  EnableRawSqlQueries = 'ENABLE_RAW_SQL_QUERIES',
  ScylladbRoutingEnabled = 'SCYLLADB_ROUTING_ENABLED',
  ServiceinstanceDataloaderForStaticUrl = 'SERVICEINSTANCE_DATALOADER_FOR_STATIC_URL',
  SplitUsageQueries = 'SPLIT_USAGE_QUERIES',
  TwoFactorEnforcementRollout = 'TWO_FACTOR_ENFORCEMENT_ROLLOUT',
  UpdatedVmQueries = 'UPDATED_VM_QUERIES',
  UseGhWebhooksForChangeDetection = 'USE_GH_WEBHOOKS_FOR_CHANGE_DETECTION',
  VmTimeRangeQuery = 'VM_TIME_RANGE_QUERY'
}

export enum ActiveProjectFeatureFlag {
  LwwCanvas = 'LWW_CANVAS',
  Placeholder = 'PLACEHOLDER'
}

export enum ActiveServiceFeatureFlag {
  CopyVolumeToEnvironment = 'COPY_VOLUME_TO_ENVIRONMENT',
  EnableDockerExtension = 'ENABLE_DOCKER_EXTENSION',
  EnableOnlineVolumeResizing = 'ENABLE_ONLINE_VOLUME_RESIZING',
  Placeholder = 'PLACEHOLDER',
  UseBuilderV3ForCliDeploys = 'USE_BUILDER_V3_FOR_CLI_DEPLOYS',
  UseGhWebhooksForChangeDetection = 'USE_GH_WEBHOOKS_FOR_CHANGE_DETECTION',
  UseVmRuntime = 'USE_VM_RUNTIME'
}

export type AdoptionInfo = Node & {
  __typename?: 'AdoptionInfo';
  adoptionLevel?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['DateTime']['output'];
  deltaLevel?: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  matchedIcpEmail?: Maybe<Scalars['String']['output']>;
  monthlyEstimatedUsage?: Maybe<Scalars['Float']['output']>;
  numConfigFile: Scalars['Int']['output'];
  numCronSchedule: Scalars['Int']['output'];
  numDeploys: Scalars['Int']['output'];
  numEnvs: Scalars['Int']['output'];
  numFailedDeploys: Scalars['Int']['output'];
  numHealthcheck: Scalars['Int']['output'];
  numIconConfig: Scalars['Int']['output'];
  numRegion: Scalars['Int']['output'];
  numReplicas: Scalars['Int']['output'];
  numRootDirectory: Scalars['Int']['output'];
  numSeats: Scalars['Int']['output'];
  numServices: Scalars['Int']['output'];
  numVariables: Scalars['Int']['output'];
  numWatchPatterns: Scalars['Int']['output'];
  totalCores?: Maybe<Scalars['Float']['output']>;
  totalDisk?: Maybe<Scalars['Float']['output']>;
  totalNetwork?: Maybe<Scalars['Float']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  workspace: Workspace;
};

/** The aggregated usage of a single measurement. */
export type AggregatedUsage = {
  __typename?: 'AggregatedUsage';
  /** The measurement that was aggregated. */
  measurement: MetricMeasurement;
  /** The tags that were used to group the metric. Only the tags that were used in the `groupBy` will be present. */
  tags: MetricTags;
  /** The aggregated value. */
  value: Scalars['Float']['output'];
};

export type AllDomains = {
  __typename?: 'AllDomains';
  customDomains: Array<CustomDomain>;
  serviceDomains: Array<ServiceDomain>;
};

export type ApiToken = Node & {
  __typename?: 'ApiToken';
  displayToken: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  workspaceId?: Maybe<Scalars['String']['output']>;
};

/** Information about the current API token and its accessible workspaces. */
export type ApiTokenContext = {
  __typename?: 'ApiTokenContext';
  /** Workspaces this subject can operate on via this token or session. */
  workspaces: Array<ApiTokenWorkspace>;
};

export type ApiTokenCreateInput = {
  name: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type ApiTokenRateLimit = {
  __typename?: 'ApiTokenRateLimit';
  remainingPoints: Scalars['Int']['output'];
  resetsAt: Scalars['String']['output'];
};

export type ApiTokenWorkspace = {
  __typename?: 'ApiTokenWorkspace';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type AppliedByMember = {
  __typename?: 'AppliedByMember';
  avatar?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  username?: Maybe<Scalars['String']['output']>;
};

export type AuditLog = Node & {
  __typename?: 'AuditLog';
  context?: Maybe<Scalars['JSON']['output']>;
  createdAt: Scalars['DateTime']['output'];
  environment?: Maybe<Environment>;
  environmentId?: Maybe<Scalars['String']['output']>;
  eventType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  payload?: Maybe<Scalars['JSON']['output']>;
  project?: Maybe<Project>;
  projectId?: Maybe<Scalars['String']['output']>;
  workspaceId?: Maybe<Scalars['String']['output']>;
};

export type AuditLogEventTypeInfo = {
  __typename?: 'AuditLogEventTypeInfo';
  description: Scalars['String']['output'];
  eventType: Scalars['String']['output'];
};

export type AuditLogFilterInput = {
  /** Filter events created on or before this date */
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  /** Filter events for a single environment */
  environmentId?: InputMaybe<Scalars['String']['input']>;
  /** List of event types to filter by */
  eventTypes?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Filter events for a single project */
  projectId?: InputMaybe<Scalars['String']['input']>;
  /** Filter events created on or after this date */
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
};

export type BaseEnvironmentOverrideInput = {
  baseEnvironmentOverrideId?: InputMaybe<Scalars['String']['input']>;
};

/** The billing period for a customers subscription. */
export type BillingPeriod = {
  __typename?: 'BillingPeriod';
  end: Scalars['DateTime']['output'];
  start: Scalars['DateTime']['output'];
};

export enum Builder {
  Heroku = 'HEROKU',
  Nixpacks = 'NIXPACKS',
  Paketo = 'PAKETO',
  Railpack = 'RAILPACK'
}

export enum CdnProvider {
  DetectedCdnProviderCloudflare = 'DETECTED_CDN_PROVIDER_CLOUDFLARE',
  DetectedCdnProviderUnspecified = 'DETECTED_CDN_PROVIDER_UNSPECIFIED',
  Unrecognized = 'UNRECOGNIZED'
}

export type CertificatePublicData = {
  __typename?: 'CertificatePublicData';
  domainNames: Array<Scalars['String']['output']>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  fingerprintSha256: Scalars['String']['output'];
  issuedAt?: Maybe<Scalars['DateTime']['output']>;
  keyType: KeyType;
};

export enum CertificateStatus {
  CertificateStatusTypeIssueFailed = 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED',
  CertificateStatusTypeIssuing = 'CERTIFICATE_STATUS_TYPE_ISSUING',
  CertificateStatusTypeUnspecified = 'CERTIFICATE_STATUS_TYPE_UNSPECIFIED',
  CertificateStatusTypeValid = 'CERTIFICATE_STATUS_TYPE_VALID',
  CertificateStatusTypeValidatingOwnership = 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
  Unrecognized = 'UNRECOGNIZED'
}

export enum CertificateStatusDetailed {
  CertificateStatusTypeDetailedCleaningUp = 'CERTIFICATE_STATUS_TYPE_DETAILED_CLEANING_UP',
  CertificateStatusTypeDetailedComplete = 'CERTIFICATE_STATUS_TYPE_DETAILED_COMPLETE',
  CertificateStatusTypeDetailedCreatingOrder = 'CERTIFICATE_STATUS_TYPE_DETAILED_CREATING_ORDER',
  CertificateStatusTypeDetailedDownloadingCertificate = 'CERTIFICATE_STATUS_TYPE_DETAILED_DOWNLOADING_CERTIFICATE',
  CertificateStatusTypeDetailedFailed = 'CERTIFICATE_STATUS_TYPE_DETAILED_FAILED',
  CertificateStatusTypeDetailedFetchingAuthorizations = 'CERTIFICATE_STATUS_TYPE_DETAILED_FETCHING_AUTHORIZATIONS',
  CertificateStatusTypeDetailedFinalizingOrder = 'CERTIFICATE_STATUS_TYPE_DETAILED_FINALIZING_ORDER',
  CertificateStatusTypeDetailedGeneratingKeys = 'CERTIFICATE_STATUS_TYPE_DETAILED_GENERATING_KEYS',
  CertificateStatusTypeDetailedInitiatingChallenges = 'CERTIFICATE_STATUS_TYPE_DETAILED_INITIATING_CHALLENGES',
  CertificateStatusTypeDetailedPollingAuthorizations = 'CERTIFICATE_STATUS_TYPE_DETAILED_POLLING_AUTHORIZATIONS',
  CertificateStatusTypeDetailedPresentingChallenges = 'CERTIFICATE_STATUS_TYPE_DETAILED_PRESENTING_CHALLENGES',
  CertificateStatusTypeDetailedUnspecified = 'CERTIFICATE_STATUS_TYPE_DETAILED_UNSPECIFIED',
  Unrecognized = 'UNRECOGNIZED'
}

export type CnameCheck = {
  __typename?: 'CnameCheck';
  link?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  status: CnameCheckStatus;
};

export enum CnameCheckStatus {
  Error = 'ERROR',
  Info = 'INFO',
  Invalid = 'INVALID',
  Valid = 'VALID',
  Waiting = 'WAITING'
}

export type ComplianceAgreementsInfo = {
  __typename?: 'ComplianceAgreementsInfo';
  /** Whether the workspace has a signed Business Associate Agreement (HIPAA) */
  hasBAA: Scalars['Boolean']['output'];
  /** Whether the workspace has a Data Processing Agreement (GDPR) */
  hasDPA: Scalars['Boolean']['output'];
};

export type Container = Node & {
  __typename?: 'Container';
  createdAt: Scalars['DateTime']['output'];
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  environment: Environment;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  migratedAt?: Maybe<Scalars['DateTime']['output']>;
  plugin: Plugin;
  pluginId: Scalars['String']['output'];
};

export type Credit = Node & {
  __typename?: 'Credit';
  amount: Scalars['Float']['output'];
  createdAt: Scalars['DateTime']['output'];
  customerId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  memo?: Maybe<Scalars['String']['output']>;
  type: CreditType;
  updatedAt: Scalars['DateTime']['output'];
};

export enum CreditType {
  Applied = 'APPLIED',
  Credit = 'CREDIT',
  Debit = 'DEBIT',
  Stripe = 'STRIPE',
  Transfer = 'TRANSFER',
  Waived = 'WAIVED'
}

export type CustomDomain = Domain & {
  __typename?: 'CustomDomain';
  /** @deprecated Use the `status` field instead. */
  cnameCheck: CnameCheck;
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  domain: Scalars['String']['output'];
  edgeId?: Maybe<Scalars['String']['output']>;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  projectId?: Maybe<Scalars['String']['output']>;
  serviceId: Scalars['String']['output'];
  status: CustomDomainStatus;
  targetPort?: Maybe<Scalars['Int']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type CustomDomainCreateInput = {
  domain: Scalars['String']['input'];
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  targetPort?: InputMaybe<Scalars['Int']['input']>;
};

export type CustomDomainStatus = {
  __typename?: 'CustomDomainStatus';
  cdnProvider?: Maybe<CdnProvider>;
  certificateStatus: CertificateStatus;
  certificateStatusDetailed?: Maybe<CertificateStatusDetailed>;
  certificates?: Maybe<Array<CertificatePublicData>>;
  dnsRecords: Array<DnsRecords>;
};

export type Customer = Node & {
  __typename?: 'Customer';
  /** The total amount of credits that have been applied during the current billing period. */
  appliedCredits: Scalars['Float']['output'];
  billingAddress?: Maybe<CustomerAddress>;
  billingEmail?: Maybe<Scalars['String']['output']>;
  billingPeriod: BillingPeriod;
  /** The total amount of unused credits for the customer. */
  creditBalance: Scalars['Float']['output'];
  credits: CustomerCreditsConnection;
  /** The current usage for the customer. This value is cached and may not be up to date. */
  currentUsage: Scalars['Float']['output'];
  defaultPaymentMethod?: Maybe<PaymentMethod>;
  defaultPaymentMethodId?: Maybe<Scalars['String']['output']>;
  hasExhaustedFreePlan: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  invoices: Array<CustomerInvoice>;
  isPrepaying: Scalars['Boolean']['output'];
  isTrialing: Scalars['Boolean']['output'];
  isUsageSubscriber: Scalars['Boolean']['output'];
  isWithdrawingToCredits: Scalars['Boolean']['output'];
  planLimitOverride?: Maybe<PlanLimitOverride>;
  remainingUsageCreditBalance: Scalars['Float']['output'];
  state: SubscriptionState;
  stripeCustomerId: Scalars['String']['output'];
  subscriptions: Array<CustomerSubscription>;
  supportedWithdrawalPlatforms: Array<WithdrawalPlatformTypes>;
  taxIds: Array<CustomerTaxId>;
  trialDaysRemaining: Scalars['Int']['output'];
  usageLimit?: Maybe<UsageLimit>;
  workspace: Workspace;
};


export type CustomerCreditsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type CustomerAddress = {
  __typename?: 'CustomerAddress';
  city?: Maybe<Scalars['String']['output']>;
  country?: Maybe<Scalars['String']['output']>;
  line1?: Maybe<Scalars['String']['output']>;
  line2?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
  state?: Maybe<Scalars['String']['output']>;
};

export type CustomerCreditsConnection = {
  __typename?: 'CustomerCreditsConnection';
  edges: Array<CustomerCreditsConnectionEdge>;
  pageInfo: PageInfo;
};

export type CustomerCreditsConnectionEdge = {
  __typename?: 'CustomerCreditsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Credit;
};

export type CustomerInvoice = {
  __typename?: 'CustomerInvoice';
  amountDue: Scalars['Float']['output'];
  amountPaid: Scalars['Float']['output'];
  hostedURL?: Maybe<Scalars['String']['output']>;
  invoiceId: Scalars['String']['output'];
  items: Array<SubscriptionItem>;
  lastPaymentError?: Maybe<Scalars['String']['output']>;
  paymentIntentStatus?: Maybe<Scalars['String']['output']>;
  pdfURL?: Maybe<Scalars['String']['output']>;
  periodEnd: Scalars['String']['output'];
  periodStart: Scalars['String']['output'];
  reissuedInvoiceFrom?: Maybe<Scalars['String']['output']>;
  reissuedInvoiceOf?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  subscriptionId?: Maybe<Scalars['String']['output']>;
  subscriptionStatus?: Maybe<Scalars['String']['output']>;
  total: Scalars['Int']['output'];
};

export type CustomerSubscription = {
  __typename?: 'CustomerSubscription';
  billingCycleAnchor: Scalars['DateTime']['output'];
  cancelAt?: Maybe<Scalars['String']['output']>;
  cancelAtPeriodEnd: Scalars['Boolean']['output'];
  couponId?: Maybe<Scalars['String']['output']>;
  discounts: Array<SubscriptionDiscount>;
  id: Scalars['String']['output'];
  items: Array<SubscriptionItem>;
  latestInvoiceId: Scalars['String']['output'];
  nextInvoiceCurrentTotal: Scalars['Int']['output'];
  nextInvoiceDate: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type CustomerTaxId = {
  __typename?: 'CustomerTaxId';
  id: Scalars['String']['output'];
  type: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

export enum DnsRecordPurpose {
  DnsRecordPurposeAcmeDns01Challenge = 'DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE',
  DnsRecordPurposeTrafficRoute = 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE',
  DnsRecordPurposeUnspecified = 'DNS_RECORD_PURPOSE_UNSPECIFIED',
  Unrecognized = 'UNRECOGNIZED'
}

export enum DnsRecordStatus {
  DnsRecordStatusPropagated = 'DNS_RECORD_STATUS_PROPAGATED',
  DnsRecordStatusRequiresUpdate = 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
  DnsRecordStatusUnspecified = 'DNS_RECORD_STATUS_UNSPECIFIED',
  Unrecognized = 'UNRECOGNIZED'
}

export enum DnsRecordType {
  DnsRecordTypeA = 'DNS_RECORD_TYPE_A',
  DnsRecordTypeCname = 'DNS_RECORD_TYPE_CNAME',
  DnsRecordTypeNs = 'DNS_RECORD_TYPE_NS',
  DnsRecordTypeUnspecified = 'DNS_RECORD_TYPE_UNSPECIFIED',
  Unrecognized = 'UNRECOGNIZED'
}

export type DnsRecords = {
  __typename?: 'DNSRecords';
  currentValue: Scalars['String']['output'];
  fqdn: Scalars['String']['output'];
  hostlabel: Scalars['String']['output'];
  purpose: DnsRecordPurpose;
  recordType: DnsRecordType;
  requiredValue: Scalars['String']['output'];
  status: DnsRecordStatus;
  zone: Scalars['String']['output'];
};

export type Deployment = Node & {
  __typename?: 'Deployment';
  canRedeploy: Scalars['Boolean']['output'];
  canRollback: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  creator?: Maybe<DeploymentCreator>;
  /** Check if a deployment's instances have all stopped */
  deploymentStopped: Scalars['Boolean']['output'];
  environment: Environment;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  instances: Array<DeploymentDeploymentInstance>;
  meta?: Maybe<Scalars['DeploymentMeta']['output']>;
  projectId: Scalars['String']['output'];
  service: Service;
  serviceId?: Maybe<Scalars['String']['output']>;
  snapshotId?: Maybe<Scalars['String']['output']>;
  sockets: Array<DeploymentSocket>;
  staticUrl?: Maybe<Scalars['String']['output']>;
  status: DeploymentStatus;
  statusUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  suggestAddServiceDomain: Scalars['Boolean']['output'];
  updatedAt: Scalars['DateTime']['output'];
  url?: Maybe<Scalars['String']['output']>;
};

export type DeploymentCreator = {
  __typename?: 'DeploymentCreator';
  avatar?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
};

export type DeploymentDeploymentInstance = {
  __typename?: 'DeploymentDeploymentInstance';
  id: Scalars['String']['output'];
  status: DeploymentInstanceStatus;
};

export type DeploymentEvent = Node & {
  __typename?: 'DeploymentEvent';
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  payload?: Maybe<DeploymentEventPayload>;
  step: DeploymentEventStep;
};

export type DeploymentEventPayload = {
  __typename?: 'DeploymentEventPayload';
  error?: Maybe<Scalars['String']['output']>;
};

export enum DeploymentEventStep {
  BuildImage = 'BUILD_IMAGE',
  CreateContainer = 'CREATE_CONTAINER',
  DrainInstances = 'DRAIN_INSTANCES',
  Healthcheck = 'HEALTHCHECK',
  MigrateVolumes = 'MIGRATE_VOLUMES',
  PreDeployCommand = 'PRE_DEPLOY_COMMAND',
  PublishImage = 'PUBLISH_IMAGE',
  SnapshotCode = 'SNAPSHOT_CODE',
  WaitForDependencies = 'WAIT_FOR_DEPENDENCIES'
}

export type DeploymentInstanceExecution = Node & {
  __typename?: 'DeploymentInstanceExecution';
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  deploymentId: Scalars['String']['output'];
  deploymentMeta: Scalars['DeploymentMeta']['output'];
  id: Scalars['ID']['output'];
  status: DeploymentInstanceStatus;
  updatedAt: Scalars['DateTime']['output'];
};

export type DeploymentInstanceExecutionCreateInput = {
  serviceInstanceId: Scalars['String']['input'];
};

export type DeploymentInstanceExecutionInput = {
  deploymentId: Scalars['String']['input'];
};

export type DeploymentInstanceExecutionListInput = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};

export enum DeploymentInstanceStatus {
  Crashed = 'CRASHED',
  Created = 'CREATED',
  Exited = 'EXITED',
  Initializing = 'INITIALIZING',
  Removed = 'REMOVED',
  Removing = 'REMOVING',
  Restarting = 'RESTARTING',
  Running = 'RUNNING',
  Skipped = 'SKIPPED',
  Stopped = 'STOPPED'
}

export type DeploymentListInput = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  includeDeleted?: InputMaybe<Scalars['Boolean']['input']>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  serviceId?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<DeploymentStatusInput>;
};

export type DeploymentSnapshot = Node & {
  __typename?: 'DeploymentSnapshot';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
  variables: Scalars['EnvironmentVariables']['output'];
};

export type DeploymentSocket = {
  __typename?: 'DeploymentSocket';
  ipv6: Scalars['Boolean']['output'];
  port: Scalars['Int']['output'];
  processName: Scalars['String']['output'];
  updatedAt: Scalars['Int']['output'];
};

export enum DeploymentStatus {
  Building = 'BUILDING',
  Crashed = 'CRASHED',
  Deploying = 'DEPLOYING',
  Failed = 'FAILED',
  Initializing = 'INITIALIZING',
  NeedsApproval = 'NEEDS_APPROVAL',
  Queued = 'QUEUED',
  Removed = 'REMOVED',
  Removing = 'REMOVING',
  Skipped = 'SKIPPED',
  Sleeping = 'SLEEPING',
  Success = 'SUCCESS',
  Waiting = 'WAITING'
}

export type DeploymentStatusInput = {
  in?: InputMaybe<Array<DeploymentStatus>>;
  notIn?: InputMaybe<Array<DeploymentStatus>>;
};

export type DeploymentTrigger = Node & {
  __typename?: 'DeploymentTrigger';
  baseEnvironmentOverrideId?: Maybe<Scalars['String']['output']>;
  branch: Scalars['String']['output'];
  checkSuites: Scalars['Boolean']['output'];
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  projectId: Scalars['String']['output'];
  provider: Scalars['String']['output'];
  repository: Scalars['String']['output'];
  serviceId?: Maybe<Scalars['String']['output']>;
  validCheckSuites: Scalars['Int']['output'];
};

export type DeploymentTriggerCreateInput = {
  branch: Scalars['String']['input'];
  checkSuites?: InputMaybe<Scalars['Boolean']['input']>;
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  provider: Scalars['String']['input'];
  repository: Scalars['String']['input'];
  rootDirectory?: InputMaybe<Scalars['String']['input']>;
  serviceId: Scalars['String']['input'];
};

export type DeploymentTriggerUpdateInput = {
  branch?: InputMaybe<Scalars['String']['input']>;
  checkSuites?: InputMaybe<Scalars['Boolean']['input']>;
  repository?: InputMaybe<Scalars['String']['input']>;
  rootDirectory?: InputMaybe<Scalars['String']['input']>;
};

export type DockerComposeImport = {
  __typename?: 'DockerComposeImport';
  errors: Array<Scalars['String']['output']>;
  patch?: Maybe<Scalars['EnvironmentConfig']['output']>;
};

export type Domain = {
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  domain: Scalars['String']['output'];
  edgeId?: Maybe<Scalars['String']['output']>;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  projectId?: Maybe<Scalars['String']['output']>;
  serviceId: Scalars['String']['output'];
  targetPort?: Maybe<Scalars['Int']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type DomainAvailable = {
  __typename?: 'DomainAvailable';
  available: Scalars['Boolean']['output'];
  message: Scalars['String']['output'];
};

export type DomainWithStatus = {
  __typename?: 'DomainWithStatus';
  cdnProvider?: Maybe<CdnProvider>;
  certificateStatus: CertificateStatus;
  certificateStatusDetailed?: Maybe<CertificateStatusDetailed>;
  certificates?: Maybe<Array<CertificatePublicData>>;
  dnsRecords: Array<DnsRecords>;
  domain?: Maybe<Domain>;
};

export type EgressGateway = {
  __typename?: 'EgressGateway';
  ipv4: Scalars['String']['output'];
  region: Scalars['String']['output'];
};

export type EgressGatewayCreateInput = {
  environmentId: Scalars['String']['input'];
  region?: InputMaybe<Scalars['String']['input']>;
  serviceId: Scalars['String']['input'];
};

export type EgressGatewayServiceTargetInput = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};

export type Environment = Node & {
  __typename?: 'Environment';
  canAccess: Scalars['Boolean']['output'];
  config: Scalars['EnvironmentConfig']['output'];
  createdAt: Scalars['DateTime']['output'];
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  deploymentTriggers: EnvironmentDeploymentTriggersConnection;
  deployments: EnvironmentDeploymentsConnection;
  id: Scalars['ID']['output'];
  isEphemeral: Scalars['Boolean']['output'];
  meta?: Maybe<EnvironmentMeta>;
  name: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  serviceInstances: EnvironmentServiceInstancesConnection;
  sourceEnvironment?: Maybe<Environment>;
  unmergedChangesCount?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  variables: EnvironmentVariablesConnection;
  volumeInstances: EnvironmentVolumeInstancesConnection;
};


export type EnvironmentConfigArgs = {
  decryptVariables?: InputMaybe<Scalars['Boolean']['input']>;
};


export type EnvironmentDeploymentTriggersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type EnvironmentDeploymentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type EnvironmentServiceInstancesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type EnvironmentVariablesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type EnvironmentVolumeInstancesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type EnvironmentCreateInput = {
  /** If true, the changes will be applied in the background and the mutation will return immediately. If false, the mutation will wait for the changes to be applied before returning. */
  applyChangesInBackground?: InputMaybe<Scalars['Boolean']['input']>;
  ephemeral?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  /** When committing the changes immediately, skip any initial deployments. */
  skipInitialDeploys?: InputMaybe<Scalars['Boolean']['input']>;
  /** Create the environment with all of the services, volumes, configuration, and variables from this source environment. */
  sourceEnvironmentId?: InputMaybe<Scalars['String']['input']>;
  /** Stage the initial changes for the environment. If false (default), the changes will be committed immediately. */
  stageInitialChanges?: InputMaybe<Scalars['Boolean']['input']>;
};

export type EnvironmentDeploymentTriggersConnection = {
  __typename?: 'EnvironmentDeploymentTriggersConnection';
  edges: Array<EnvironmentDeploymentTriggersConnectionEdge>;
  pageInfo: PageInfo;
};

export type EnvironmentDeploymentTriggersConnectionEdge = {
  __typename?: 'EnvironmentDeploymentTriggersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: DeploymentTrigger;
};

export type EnvironmentDeploymentsConnection = {
  __typename?: 'EnvironmentDeploymentsConnection';
  edges: Array<EnvironmentDeploymentsConnectionEdge>;
  pageInfo: PageInfo;
};

export type EnvironmentDeploymentsConnectionEdge = {
  __typename?: 'EnvironmentDeploymentsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Deployment;
};

export type EnvironmentMeta = {
  __typename?: 'EnvironmentMeta';
  baseBranch?: Maybe<Scalars['String']['output']>;
  branch?: Maybe<Scalars['String']['output']>;
  latestSuccessfulGitHubDeploymentId?: Maybe<Scalars['Int']['output']>;
  prCommentId?: Maybe<Scalars['Int']['output']>;
  prNumber?: Maybe<Scalars['Int']['output']>;
  prRepo?: Maybe<Scalars['String']['output']>;
  prTitle?: Maybe<Scalars['String']['output']>;
};

export type EnvironmentPatch = Node & {
  __typename?: 'EnvironmentPatch';
  appliedAt?: Maybe<Scalars['DateTime']['output']>;
  appliedBy?: Maybe<AppliedByMember>;
  createdAt: Scalars['DateTime']['output'];
  environment: Environment;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastAppliedError?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  patch: Scalars['EnvironmentConfig']['output'];
  status: EnvironmentPatchStatus;
  updatedAt: Scalars['DateTime']['output'];
};


export type EnvironmentPatchPatchArgs = {
  decryptVariables?: InputMaybe<Scalars['Boolean']['input']>;
};

export enum EnvironmentPatchStatus {
  Applying = 'APPLYING',
  Committed = 'COMMITTED',
  Staged = 'STAGED'
}

export type EnvironmentRenameInput = {
  name: Scalars['String']['input'];
};

export type EnvironmentServiceInstancesConnection = {
  __typename?: 'EnvironmentServiceInstancesConnection';
  edges: Array<EnvironmentServiceInstancesConnectionEdge>;
  pageInfo: PageInfo;
};

export type EnvironmentServiceInstancesConnectionEdge = {
  __typename?: 'EnvironmentServiceInstancesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ServiceInstance;
};

export type EnvironmentTriggersDeployInput = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};

export type EnvironmentVariablesConnection = {
  __typename?: 'EnvironmentVariablesConnection';
  edges: Array<EnvironmentVariablesConnectionEdge>;
  pageInfo: PageInfo;
};

export type EnvironmentVariablesConnectionEdge = {
  __typename?: 'EnvironmentVariablesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Variable;
};

export type EnvironmentVolumeInstancesConnection = {
  __typename?: 'EnvironmentVolumeInstancesConnection';
  edges: Array<EnvironmentVolumeInstancesConnectionEdge>;
  pageInfo: PageInfo;
};

export type EnvironmentVolumeInstancesConnectionEdge = {
  __typename?: 'EnvironmentVolumeInstancesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: VolumeInstance;
};

/** The estimated usage of a single measurement. */
export type EstimatedUsage = {
  __typename?: 'EstimatedUsage';
  /** The estimated value. */
  estimatedValue: Scalars['Float']['output'];
  /** The measurement that was estimated. */
  measurement: MetricMeasurement;
  projectId: Scalars['String']['output'];
};

export type Event = Node & {
  __typename?: 'Event';
  action: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  environment?: Maybe<Environment>;
  environmentId?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  object: Scalars['String']['output'];
  payload?: Maybe<Scalars['JSON']['output']>;
  project: Project;
  projectId?: Maybe<Scalars['String']['output']>;
  severity: EventSeverity;
};

export type EventFilterInput = {
  action?: InputMaybe<EventStringListFilter>;
  object?: InputMaybe<EventStringListFilter>;
};

export enum EventSeverity {
  Critical = 'CRITICAL',
  Info = 'INFO',
  Notice = 'NOTICE',
  Warning = 'WARNING'
}

export type EventStringListFilter = {
  in?: InputMaybe<Array<Scalars['String']['input']>>;
  notIn?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type ExplicitOwnerInput = {
  /** The ID of the owner */
  id: Scalars['String']['input'];
  /** The type of owner */
  type?: InputMaybe<ResourceOwnerType>;
};

export type ExternalWorkspace = {
  __typename?: 'ExternalWorkspace';
  allowDeprecatedRegions?: Maybe<Scalars['Boolean']['output']>;
  avatar?: Maybe<Scalars['String']['output']>;
  banReason?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  currentSessionHasAccess?: Maybe<Scalars['Boolean']['output']>;
  customerId?: Maybe<Scalars['String']['output']>;
  customerState: SubscriptionState;
  discordRole?: Maybe<Scalars['String']['output']>;
  has2FAEnforcement: Scalars['Boolean']['output'];
  hasBAA: Scalars['Boolean']['output'];
  hasRBAC: Scalars['Boolean']['output'];
  hasSAML: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  isTrialing?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  plan: Plan;
  preferredRegion?: Maybe<Scalars['String']['output']>;
  projects: Array<Project>;
  redactedDueTo2FAPending: Scalars['Boolean']['output'];
  supportTierOverride?: Maybe<Scalars['String']['output']>;
  teamId?: Maybe<Scalars['String']['output']>;
};

export type FeatureFlagToggleInput = {
  flag: ActiveFeatureFlag;
};

export type FunctionRuntime = {
  __typename?: 'FunctionRuntime';
  /** The image of the function runtime */
  image: Scalars['String']['output'];
  /** The latest version of the function runtime */
  latestVersion: FunctionRuntimeVersion;
  /** The name of the function runtime */
  name: FunctionRuntimeName;
  /** The versions of the function runtime */
  versions: Array<FunctionRuntimeVersion>;
};

/** Supported function runtime environments */
export enum FunctionRuntimeName {
  Bun = 'bun'
}

export type FunctionRuntimeVersion = {
  __typename?: 'FunctionRuntimeVersion';
  image: Scalars['String']['output'];
  tag: Scalars['String']['output'];
};

export type GitHubAccess = {
  __typename?: 'GitHubAccess';
  hasAccess: Scalars['Boolean']['output'];
  isPublic: Scalars['Boolean']['output'];
};

export type GitHubBranch = {
  __typename?: 'GitHubBranch';
  name: Scalars['String']['output'];
};

export type GitHubRepo = {
  __typename?: 'GitHubRepo';
  defaultBranch: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  fullName: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  installationId: Scalars['String']['output'];
  isPrivate: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  ownerAvatarUrl?: Maybe<Scalars['String']['output']>;
};

export type GitHubRepoDeployInput = {
  branch?: InputMaybe<Scalars['String']['input']>;
  environmentId?: InputMaybe<Scalars['String']['input']>;
  projectId: Scalars['String']['input'];
  repo: Scalars['String']['input'];
};

export type GitHubRepoUpdateInput = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};

export type GitHubRepoWithoutInstallation = {
  __typename?: 'GitHubRepoWithoutInstallation';
  defaultBranch: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  fullName: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  isPrivate: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type HerokuApp = {
  __typename?: 'HerokuApp';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type HerokuImportVariablesInput = {
  environmentId: Scalars['String']['input'];
  herokuAppId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};

/** The result of a http logs query. */
export type HttpLog = {
  __typename?: 'HttpLog';
  /** The client user agent */
  clientUa: Scalars['String']['output'];
  /** The deployment ID that was requested */
  deploymentId: Scalars['String']['output'];
  /** The deployment instance ID that was requested */
  deploymentInstanceId: Scalars['String']['output'];
  /** The downstream HTTP protocol version */
  downstreamProto: Scalars['String']['output'];
  /** The edge region the client connected to */
  edgeRegion: Scalars['String']['output'];
  /** The requested host */
  host: Scalars['String']['output'];
  /** The http status of the log */
  httpStatus: Scalars['Int']['output'];
  /** The request HTTP method */
  method: Scalars['String']['output'];
  /** The requested path */
  path: Scalars['String']['output'];
  /** The unique request ID */
  requestId: Scalars['String']['output'];
  /** Details about the upstream response */
  responseDetails: Scalars['String']['output'];
  /** Received bytes */
  rxBytes: Scalars['Int']['output'];
  /** The source IP of the request */
  srcIp: Scalars['String']['output'];
  /** The timestamp the log was created */
  timestamp: Scalars['String']['output'];
  /** The total duration the request took */
  totalDuration: Scalars['Int']['output'];
  /** Outgoing bytes */
  txBytes: Scalars['Int']['output'];
  /** The upstream address */
  upstreamAddress: Scalars['String']['output'];
  /** Any upstream errors that occurred */
  upstreamErrors: Scalars['String']['output'];
  /** The upstream HTTP protocol version */
  upstreamProto: Scalars['String']['output'];
  /** How long the upstream request took to respond */
  upstreamRqDuration: Scalars['Int']['output'];
};

export type Incident = {
  __typename?: 'Incident';
  id: Scalars['String']['output'];
  message: Scalars['String']['output'];
  status: IncidentStatus;
  url: Scalars['String']['output'];
};

export enum IncidentStatus {
  Identified = 'IDENTIFIED',
  Investigating = 'INVESTIGATING',
  Monitoring = 'MONITORING',
  Resolved = 'RESOLVED'
}

export type Integration = Node & {
  __typename?: 'Integration';
  config: Scalars['JSON']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
};

export type IntegrationAuth = Node & {
  __typename?: 'IntegrationAuth';
  id: Scalars['ID']['output'];
  integrations: IntegrationAuthIntegrationsConnection;
  provider: Scalars['String']['output'];
  providerId: Scalars['String']['output'];
};


export type IntegrationAuthIntegrationsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type IntegrationAuthIntegrationsConnection = {
  __typename?: 'IntegrationAuthIntegrationsConnection';
  edges: Array<IntegrationAuthIntegrationsConnectionEdge>;
  pageInfo: PageInfo;
};

export type IntegrationAuthIntegrationsConnectionEdge = {
  __typename?: 'IntegrationAuthIntegrationsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Integration;
};

export type IntegrationCreateInput = {
  config: Scalars['JSON']['input'];
  integrationAuthId?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type IntegrationUpdateInput = {
  config: Scalars['JSON']['input'];
  integrationAuthId?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type InviteCode = Node & {
  __typename?: 'InviteCode';
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  project: Project;
  projectId: Scalars['String']['output'];
  role: ProjectRole;
};

export type JobApplicationCreateInput = {
  email: Scalars['String']['input'];
  jobId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  why: Scalars['String']['input'];
};

export enum KeyType {
  KeyTypeEcdsa = 'KEY_TYPE_ECDSA',
  KeyTypeRsa_2048 = 'KEY_TYPE_RSA_2048',
  KeyTypeRsa_4096 = 'KEY_TYPE_RSA_4096',
  KeyTypeUnspecified = 'KEY_TYPE_UNSPECIFIED',
  Unrecognized = 'UNRECOGNIZED'
}

/** The result of a logs query. */
export type Log = {
  __typename?: 'Log';
  /** The attributes that were parsed from a structured log */
  attributes: Array<LogAttribute>;
  /** The contents of the log message */
  message: Scalars['String']['output'];
  /** The severity of the log message (eg. err) */
  severity?: Maybe<Scalars['String']['output']>;
  /** The tags that were associated with the log */
  tags?: Maybe<LogTags>;
  /** The timestamp of the log message in format RFC3339 (nano) */
  timestamp: Scalars['String']['output'];
};

/** The attributes associated with a structured log */
export type LogAttribute = {
  __typename?: 'LogAttribute';
  key: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

/** The tags associated with a specific log */
export type LogTags = {
  __typename?: 'LogTags';
  deploymentId?: Maybe<Scalars['String']['output']>;
  deploymentInstanceId?: Maybe<Scalars['String']['output']>;
  environmentId?: Maybe<Scalars['String']['output']>;
  /** @deprecated Plugins have been removed */
  pluginId?: Maybe<Scalars['String']['output']>;
  projectId?: Maybe<Scalars['String']['output']>;
  serviceId?: Maybe<Scalars['String']['output']>;
  snapshotId?: Maybe<Scalars['String']['output']>;
};

export type LoginSessionAuthInput = {
  code: Scalars['String']['input'];
  hostname?: InputMaybe<Scalars['String']['input']>;
};

export type Maintenance = {
  __typename?: 'Maintenance';
  id: Scalars['String']['output'];
  message: Scalars['String']['output'];
  start: Scalars['DateTime']['output'];
  status: MaintenanceStatus;
  url: Scalars['String']['output'];
};

export enum MaintenanceStatus {
  Completed = 'COMPLETED',
  Inprogress = 'INPROGRESS',
  Notstartedyet = 'NOTSTARTEDYET'
}

/** A single sample of a metric. */
export type Metric = {
  __typename?: 'Metric';
  /** The timestamp of the sample. Represented has number of seconds since the Unix epoch. */
  ts: Scalars['Int']['output'];
  /** The value of the sample. */
  value: Scalars['Float']['output'];
};

/** A thing that can be measured on Railway. */
export enum MetricMeasurement {
  BackupUsageGb = 'BACKUP_USAGE_GB',
  CpuLimit = 'CPU_LIMIT',
  CpuUsage = 'CPU_USAGE',
  CpuUsage_2 = 'CPU_USAGE_2',
  DiskUsageGb = 'DISK_USAGE_GB',
  EphemeralDiskUsageGb = 'EPHEMERAL_DISK_USAGE_GB',
  MeasurementUnspecified = 'MEASUREMENT_UNSPECIFIED',
  MemoryLimitGb = 'MEMORY_LIMIT_GB',
  MemoryUsageGb = 'MEMORY_USAGE_GB',
  NetworkRxGb = 'NETWORK_RX_GB',
  NetworkTxGb = 'NETWORK_TX_GB',
  Unrecognized = 'UNRECOGNIZED'
}

/** A property that can be used to group metrics. */
export enum MetricTag {
  DeploymentId = 'DEPLOYMENT_ID',
  DeploymentInstanceId = 'DEPLOYMENT_INSTANCE_ID',
  EnvironmentId = 'ENVIRONMENT_ID',
  HostType = 'HOST_TYPE',
  KeyUnspecified = 'KEY_UNSPECIFIED',
  PluginId = 'PLUGIN_ID',
  ProjectId = 'PROJECT_ID',
  Region = 'REGION',
  ServiceId = 'SERVICE_ID',
  Unrecognized = 'UNRECOGNIZED',
  VolumeId = 'VOLUME_ID',
  VolumeInstanceId = 'VOLUME_INSTANCE_ID'
}

/** The tags that were used to group the metric. */
export type MetricTags = {
  __typename?: 'MetricTags';
  deploymentId?: Maybe<Scalars['String']['output']>;
  deploymentInstanceId?: Maybe<Scalars['String']['output']>;
  environmentId?: Maybe<Scalars['String']['output']>;
  /** @deprecated Plugins have been removed */
  pluginId?: Maybe<Scalars['String']['output']>;
  projectId?: Maybe<Scalars['String']['output']>;
  region?: Maybe<Scalars['String']['output']>;
  serviceId?: Maybe<Scalars['String']['output']>;
  volumeId?: Maybe<Scalars['String']['output']>;
  volumeInstanceId?: Maybe<Scalars['String']['output']>;
};

/** The result of a metrics query. */
export type MetricsResult = {
  __typename?: 'MetricsResult';
  /** The measurement of the metric. */
  measurement: MetricMeasurement;
  /** The tags that were used to group the metric. Only the tags that were used to by will be present. */
  tags: MetricTags;
  /** The samples of the metric. */
  values: Array<Metric>;
};

export enum MonitorAlertResourceType {
  Service = 'SERVICE',
  Volume = 'VOLUME'
}

export enum MonitorStatus {
  Alert = 'ALERT',
  Ok = 'OK'
}

export enum MonitorThresholdCondition {
  Above = 'above',
  Below = 'below'
}

export type MonitorThresholdConfig = {
  __typename?: 'MonitorThresholdConfig';
  condition: MonitorThresholdCondition;
  measurement?: Maybe<MetricMeasurement>;
  threshold: Scalars['Float']['output'];
  type: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Creates a new API token. */
  apiTokenCreate: Scalars['String']['output'];
  /** Deletes an API token. */
  apiTokenDelete: Scalars['Boolean']['output'];
  /** Sets the base environment override for a deployment trigger. */
  baseEnvironmentOverride: Scalars['Boolean']['output'];
  /** Creates a new custom domain. */
  customDomainCreate: CustomDomain;
  /** Deletes a custom domain. */
  customDomainDelete: Scalars['Boolean']['output'];
  /** Updates a custom domain. */
  customDomainUpdate: Scalars['Boolean']['output'];
  /** Create a free plan subscription for a customer */
  customerCreateFreePlanSubscription: Scalars['Boolean']['output'];
  /** Toggle whether a customer is automatically withdrawing to credits */
  customerTogglePayoutsToCredits: Scalars['Boolean']['output'];
  /** Approves a deployment. */
  deploymentApprove: Scalars['Boolean']['output'];
  /** Cancels a deployment. */
  deploymentCancel: Scalars['Boolean']['output'];
  /** Invoke a deployment instance execution. */
  deploymentInstanceExecutionCreate: Scalars['Boolean']['output'];
  /** Redeploys a deployment. */
  deploymentRedeploy: Deployment;
  /** Removes a deployment. */
  deploymentRemove: Scalars['Boolean']['output'];
  /** Restarts a deployment. */
  deploymentRestart: Scalars['Boolean']['output'];
  /** Rolls back to a deployment. */
  deploymentRollback: Scalars['Boolean']['output'];
  /** Stops a deployment. */
  deploymentStop: Scalars['Boolean']['output'];
  /** Creates a deployment trigger. */
  deploymentTriggerCreate: DeploymentTrigger;
  /** Deletes a deployment trigger. */
  deploymentTriggerDelete: Scalars['Boolean']['output'];
  /** Updates a deployment trigger. */
  deploymentTriggerUpdate: DeploymentTrigger;
  /** Create services and volumes from docker compose */
  dockerComposeImport: DockerComposeImport;
  /** Create a new egress gateway association for a service instance */
  egressGatewayAssociationCreate: Array<EgressGateway>;
  /** Clear all egress gateway associations for a service instance */
  egressGatewayAssociationsClear: Scalars['Boolean']['output'];
  /** Change the User's account email if there is a valid change email request. */
  emailChangeConfirm: Scalars['Boolean']['output'];
  /** Initiate an email change request for a user */
  emailChangeInitiate: Scalars['Boolean']['output'];
  /** Creates a new environment. */
  environmentCreate: Environment;
  /** Deletes an environment. */
  environmentDelete: Scalars['Boolean']['output'];
  /** Commit the provided patch to the environment. */
  environmentPatchCommit: Scalars['String']['output'];
  /** Commits the staged changes for a single environment. */
  environmentPatchCommitStaged: Scalars['String']['output'];
  /** Renames an environment. */
  environmentRename: Environment;
  /** Sets the staged patch for a single environment. */
  environmentStageChanges: EnvironmentPatch;
  /** Deploys all connected triggers for an environment. */
  environmentTriggersDeploy: Scalars['Boolean']['output'];
  /** Agree to the fair use policy for the currently authenticated user */
  fairUseAgree: Scalars['Boolean']['output'];
  /** Add a feature flag for a user */
  featureFlagAdd: Scalars['Boolean']['output'];
  /** Remove a feature flag for a user */
  featureFlagRemove: Scalars['Boolean']['output'];
  /** Deploys a GitHub repo */
  githubRepoDeploy: Scalars['String']['output'];
  /** Updates a GitHub repo through the linked template */
  githubRepoUpdate: Scalars['Boolean']['output'];
  /** Import variables from a Heroku app into a Railway service. Returns the number of variables imports */
  herokuImportVariables: Scalars['Int']['output'];
  /** Create an integration for a project */
  integrationCreate: Integration;
  /** Delete an integration for a project */
  integrationDelete: Scalars['Boolean']['output'];
  /** Update an integration for a project */
  integrationUpdate: Integration;
  /** Join a project using an invite code */
  inviteCodeUse: Project;
  /** Creates a new job application. */
  jobApplicationCreate: Scalars['Boolean']['output'];
  /** Auth a login session for a user */
  loginSessionAuth: Scalars['Boolean']['output'];
  /** Cancel a login session */
  loginSessionCancel: Scalars['Boolean']['output'];
  /** Get a token for a login session if it exists */
  loginSessionConsume?: Maybe<Scalars['String']['output']>;
  /** Start a CLI login session */
  loginSessionCreate: Scalars['String']['output'];
  /** Verify if a login session is valid */
  loginSessionVerify: Scalars['Boolean']['output'];
  /** Marks notification deliveries as read */
  notificationDeliveriesMarkAsRead: Scalars['Boolean']['output'];
  /** Create an observability dashboard */
  observabilityDashboardCreate: Scalars['Boolean']['output'];
  /** Reset an observability dashboard to default dashboard items */
  observabilityDashboardReset: Scalars['Boolean']['output'];
  /** Update an observability dashboard */
  observabilityDashboardUpdate: Scalars['Boolean']['output'];
  /** Deletes a Passkey */
  passkeyDelete: Scalars['Boolean']['output'];
  /**
   * Creates a new plugin.
   * @deprecated Plugins are deprecated on Railway. Use database templates instead.
   */
  pluginCreate: Plugin;
  /**
   * Deletes a plugin.
   * @deprecated Plugins are deprecated
   */
  pluginDelete: Scalars['Boolean']['output'];
  /**
   * Reset envs and container for a plugin in an environment
   * @deprecated Plugins are deprecated
   */
  pluginReset: Scalars['Boolean']['output'];
  /**
   * Resets the credentials for a plugin in an environment
   * @deprecated Plugins are deprecated
   */
  pluginResetCredentials: Scalars['String']['output'];
  /**
   * Restarts a plugin.
   * @deprecated Plugins are deprecated
   */
  pluginRestart: Plugin;
  /**
   * Force start a plugin
   * @deprecated Plugins are deprecated
   */
  pluginStart: Scalars['Boolean']['output'];
  /**
   * Updates an existing plugin.
   * @deprecated Plugins are deprecated
   */
  pluginUpdate: Plugin;
  /** Update the email preferences for a user */
  preferencesUpdate: Preferences;
  /** Create or get a private network. */
  privateNetworkCreateOrGet: PrivateNetwork;
  /** Create or get a private network endpoint. */
  privateNetworkEndpointCreateOrGet: PrivateNetworkEndpoint;
  /** Delete a private network endpoint. */
  privateNetworkEndpointDelete: Scalars['Boolean']['output'];
  /** Rename a private network endpoint. */
  privateNetworkEndpointRename: Scalars['Boolean']['output'];
  /** Delete all private networks for an environment. */
  privateNetworksForEnvironmentDelete: Scalars['Boolean']['output'];
  /** Claims a project. */
  projectClaim: Project;
  /** Creates a new project. */
  projectCreate: Project;
  /** Deletes a project. */
  projectDelete: Scalars['Boolean']['output'];
  /** Add a feature flag for a project */
  projectFeatureFlagAdd: Scalars['Boolean']['output'];
  /** Remove a feature flag for a project */
  projectFeatureFlagRemove: Scalars['Boolean']['output'];
  /** Accept a project invitation using the invite code */
  projectInvitationAccept: ProjectPermission;
  /** Create an invitation for a project */
  projectInvitationCreate: ProjectInvitation;
  /** Delete an invitation for a project */
  projectInvitationDelete: Scalars['Boolean']['output'];
  /** Resend an invitation for a project */
  projectInvitationResend: ProjectInvitation;
  /** Invite a user by email to a project */
  projectInviteUser: Scalars['Boolean']['output'];
  /** Leave project as currently authenticated user */
  projectLeave: Scalars['Boolean']['output'];
  /** Remove user from a project */
  projectMemberRemove: Array<ProjectMember>;
  /** Change the role for a user within a project */
  projectMemberUpdate: ProjectMember;
  /** Deletes a project with a 48 hour grace period. */
  projectScheduleDelete: Scalars['Boolean']['output'];
  /** Cancel scheduled deletion of a project */
  projectScheduleDeleteCancel: Scalars['Boolean']['output'];
  /** Force delete a scheduled deletion of a project (skips the grace period) */
  projectScheduleDeleteForce: Scalars['Boolean']['output'];
  /** Create a token for a project that has access to a specific environment */
  projectTokenCreate: Scalars['String']['output'];
  /** Delete a project token */
  projectTokenDelete: Scalars['Boolean']['output'];
  /** Transfer a project to a workspace */
  projectTransfer: Scalars['Boolean']['output'];
  /** Confirm the transfer of project ownership */
  projectTransferConfirm: Scalars['Boolean']['output'];
  /** Initiate the transfer of project ownership */
  projectTransferInitiate: Scalars['Boolean']['output'];
  /**
   * Transfer a project to a team
   * @deprecated Use projectTransfer instead
   */
  projectTransferToTeam: Scalars['Boolean']['output'];
  /** Updates a project. */
  projectUpdate: Project;
  /** Deletes a ProviderAuth. */
  providerAuthRemove: Scalars['Boolean']['output'];
  /** Generates a new set of recovery codes for the authenticated user. */
  recoveryCodeGenerate: RecoveryCodes;
  /** Validates a recovery code. */
  recoveryCodeValidate: Scalars['Boolean']['output'];
  /** Updates the ReferralInfo for the authenticated user. */
  referralInfoUpdate: ReferralInfo;
  /** Connect a service to a source */
  serviceConnect: Service;
  /** Creates a new service. */
  serviceCreate: Service;
  /** Deletes a service. */
  serviceDelete: Scalars['Boolean']['output'];
  /** Disconnect a service from a repo */
  serviceDisconnect: Service;
  /** Creates a new service domain. */
  serviceDomainCreate: ServiceDomain;
  /** Deletes a service domain. */
  serviceDomainDelete: Scalars['Boolean']['output'];
  /** Updates a service domain. */
  serviceDomainUpdate: Scalars['Boolean']['output'];
  /**
   * Duplicate a service, including its configuration, variables, and volumes.
   * @deprecated This API route is used only by the CLI. We plan to remove it in a future version. Please use the UI to duplicate services.
   */
  serviceDuplicate: Service;
  /** Add a feature flag for a service */
  serviceFeatureFlagAdd: Scalars['Boolean']['output'];
  /** Remove a feature flag for a service */
  serviceFeatureFlagRemove: Scalars['Boolean']['output'];
  /** Deploy a service instance */
  serviceInstanceDeploy: Scalars['Boolean']['output'];
  /** Deploy a service instance. Returns a deployment ID */
  serviceInstanceDeployV2: Scalars['String']['output'];
  /** Update the resource limits for a service instance */
  serviceInstanceLimitsUpdate: Scalars['Boolean']['output'];
  /** Redeploy a service instance */
  serviceInstanceRedeploy: Scalars['Boolean']['output'];
  /** Update a service instance */
  serviceInstanceUpdate: Scalars['Boolean']['output'];
  /** Remove the upstream URL from all service instances for this service */
  serviceRemoveUpstreamUrl: Service;
  /** Updates a service. */
  serviceUpdate: Service;
  /** Deletes a session. */
  sessionDelete: Scalars['Boolean']['output'];
  /** Configure a shared variable. */
  sharedVariableConfigure: Variable;
  /**
   * Creates a new TCP proxy for a service instance.
   * @deprecated Use staged changes and apply them. Creating a TCP proxy with this endpoint requires you to redeploy the service for it to be active.
   */
  tcpProxyCreate: TcpProxy;
  /** Deletes a TCP proxy by id */
  tcpProxyDelete: Scalars['Boolean']['output'];
  /** Duplicates an existing template */
  templateClone: Template;
  /** Deletes a template. */
  templateDelete: Scalars['Boolean']['output'];
  /**
   * Deploys a template.
   * @deprecated Deprecated in favor of templateDeployV2
   */
  templateDeploy: TemplateDeployPayload;
  /** Deploys a template using the serialized template config */
  templateDeployV2: TemplateDeployPayload;
  /** Generate a template for a project */
  templateGenerate: Template;
  /** Publishes a template. */
  templatePublish: Template;
  /** Ejects a service from the template and creates a new repo in the provided org. */
  templateServiceSourceEject: Scalars['Boolean']['output'];
  /** Unpublishes a template. */
  templateUnpublish: Scalars['Boolean']['output'];
  /** Create a new trusted domain for this workspace */
  trustedDomainCreate: Scalars['Boolean']['output'];
  /** Delete a trusted domain */
  trustedDomainDelete: Scalars['Boolean']['output'];
  /** Setup 2FA authorization for authenticated user. */
  twoFactorInfoCreate: RecoveryCodes;
  /** Deletes the TwoFactorInfo for the authenticated user. */
  twoFactorInfoDelete: Scalars['Boolean']['output'];
  /** Generates the 2FA app secret for the authenticated user. */
  twoFactorInfoSecret: TwoFactorInfoSecret;
  /** Validates the token for a 2FA action or for a login request. */
  twoFactorInfoValidate: Scalars['Boolean']['output'];
  /** Generate a Slack channel for a workspace */
  upsertSlackChannel: Scalars['Boolean']['output'];
  /** Remove the usage limit for a customer */
  usageLimitRemove: Scalars['Boolean']['output'];
  /** Set the usage limit for a customer */
  usageLimitSet: Scalars['Boolean']['output'];
  /** Unsubscribe from the Beta program. */
  userBetaLeave: Scalars['Boolean']['output'];
  /** Delete the currently authenticated user */
  userDelete: Scalars['Boolean']['output'];
  /** Disconnect your Railway account from Discord. */
  userDiscordDisconnect: Scalars['Boolean']['output'];
  /** Remove a flag on the user. */
  userFlagsRemove: Scalars['Boolean']['output'];
  /** Set flags on the authenticated user. */
  userFlagsSet: Scalars['Boolean']['output'];
  /** Updates the profile for the authenticated user */
  userProfileUpdate: Scalars['Boolean']['output'];
  /** Update date of TermsAgreedOn */
  userTermsUpdate?: Maybe<User>;
  /** Upserts a collection of variables. */
  variableCollectionUpsert: Scalars['Boolean']['output'];
  /** Deletes a variable. */
  variableDelete: Scalars['Boolean']['output'];
  /** Upserts a variable. */
  variableUpsert: Scalars['Boolean']['output'];
  /** Create a persistent volume in a project */
  volumeCreate: Volume;
  /** Delete a persistent volume in a project */
  volumeDelete: Scalars['Boolean']['output'];
  /** Create backup of a volume instance */
  volumeInstanceBackupCreate: WorkflowId;
  /** Deletes volume instance backup */
  volumeInstanceBackupDelete: WorkflowId;
  /** Removes backup expiration date */
  volumeInstanceBackupLock: Scalars['Boolean']['output'];
  /** Restore a volume instance from a backup */
  volumeInstanceBackupRestore: WorkflowId;
  /** Manage schedule for backups of a volume instance */
  volumeInstanceBackupScheduleUpdate: Scalars['Boolean']['output'];
  /** Update a volume instance. If no environmentId is provided, all volume instances for the volume will be updated. */
  volumeInstanceUpdate: Scalars['Boolean']['output'];
  /** Update a persistent volume in a project */
  volumeUpdate: Volume;
  /** Delete a workspace and all data associated with it */
  workspaceDelete: Scalars['Boolean']['output'];
  /** Get an invite code for a workspace and role */
  workspaceInviteCodeCreate: Scalars['String']['output'];
  /** Use an invite code to join a workspace */
  workspaceInviteCodeUse: Workspace;
  /** Leave a workspace */
  workspaceLeave: Scalars['Boolean']['output'];
  /** Changes a user workspace permissions. */
  workspacePermissionChange: Scalars['Boolean']['output'];
  /** Enable or disable 2FA enforcement for a workspace */
  workspaceTwoFactorEnforcementUpdate: Scalars['Boolean']['output'];
  /** Update a workspace by id */
  workspaceUpdate: Scalars['Boolean']['output'];
  /** Generate a Slack channel for a workspace */
  workspaceUpsertSlackChannel: Scalars['Boolean']['output'];
  /** Invite a user by email to a workspace */
  workspaceUserInvite: Scalars['Boolean']['output'];
  /** Remove a user from a workspace */
  workspaceUserRemove: Scalars['Boolean']['output'];
};


export type MutationApiTokenCreateArgs = {
  input: ApiTokenCreateInput;
};


export type MutationApiTokenDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationBaseEnvironmentOverrideArgs = {
  id: Scalars['String']['input'];
  input: BaseEnvironmentOverrideInput;
};


export type MutationCustomDomainCreateArgs = {
  input: CustomDomainCreateInput;
};


export type MutationCustomDomainDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationCustomDomainUpdateArgs = {
  environmentId: Scalars['String']['input'];
  id: Scalars['String']['input'];
  targetPort?: InputMaybe<Scalars['Int']['input']>;
};


export type MutationCustomerCreateFreePlanSubscriptionArgs = {
  id: Scalars['String']['input'];
};


export type MutationCustomerTogglePayoutsToCreditsArgs = {
  customerId: Scalars['String']['input'];
  input: CustomerTogglePayoutsToCreditsInput;
};


export type MutationDeploymentApproveArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentCancelArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentInstanceExecutionCreateArgs = {
  input: DeploymentInstanceExecutionCreateInput;
};


export type MutationDeploymentRedeployArgs = {
  id: Scalars['String']['input'];
  usePreviousImageTag?: InputMaybe<Scalars['Boolean']['input']>;
};


export type MutationDeploymentRemoveArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentRestartArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentRollbackArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentStopArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentTriggerCreateArgs = {
  input: DeploymentTriggerCreateInput;
};


export type MutationDeploymentTriggerDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeploymentTriggerUpdateArgs = {
  id: Scalars['String']['input'];
  input: DeploymentTriggerUpdateInput;
};


export type MutationDockerComposeImportArgs = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  skipStagingPatch?: InputMaybe<Scalars['Boolean']['input']>;
  yaml: Scalars['String']['input'];
};


export type MutationEgressGatewayAssociationCreateArgs = {
  input: EgressGatewayCreateInput;
};


export type MutationEgressGatewayAssociationsClearArgs = {
  input: EgressGatewayServiceTargetInput;
};


export type MutationEmailChangeConfirmArgs = {
  nonce: Scalars['String']['input'];
};


export type MutationEmailChangeInitiateArgs = {
  newEmail: Scalars['String']['input'];
};


export type MutationEnvironmentCreateArgs = {
  input: EnvironmentCreateInput;
};


export type MutationEnvironmentDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationEnvironmentPatchCommitArgs = {
  commitMessage?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  patch?: InputMaybe<Scalars['EnvironmentConfig']['input']>;
};


export type MutationEnvironmentPatchCommitStagedArgs = {
  commitMessage?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  skipDeploys?: InputMaybe<Scalars['Boolean']['input']>;
};


export type MutationEnvironmentRenameArgs = {
  id: Scalars['String']['input'];
  input: EnvironmentRenameInput;
};


export type MutationEnvironmentStageChangesArgs = {
  environmentId: Scalars['String']['input'];
  input: Scalars['EnvironmentConfig']['input'];
  merge?: InputMaybe<Scalars['Boolean']['input']>;
};


export type MutationEnvironmentTriggersDeployArgs = {
  input: EnvironmentTriggersDeployInput;
};


export type MutationFairUseAgreeArgs = {
  agree: Scalars['Boolean']['input'];
};


export type MutationFeatureFlagAddArgs = {
  input: FeatureFlagToggleInput;
};


export type MutationFeatureFlagRemoveArgs = {
  input: FeatureFlagToggleInput;
};


export type MutationGithubRepoDeployArgs = {
  input: GitHubRepoDeployInput;
};


export type MutationGithubRepoUpdateArgs = {
  input: GitHubRepoUpdateInput;
};


export type MutationHerokuImportVariablesArgs = {
  input: HerokuImportVariablesInput;
};


export type MutationIntegrationCreateArgs = {
  input: IntegrationCreateInput;
};


export type MutationIntegrationDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationIntegrationUpdateArgs = {
  id: Scalars['String']['input'];
  input: IntegrationUpdateInput;
};


export type MutationInviteCodeUseArgs = {
  code: Scalars['String']['input'];
};


export type MutationJobApplicationCreateArgs = {
  input: JobApplicationCreateInput;
  resume: Scalars['Upload']['input'];
};


export type MutationLoginSessionAuthArgs = {
  input: LoginSessionAuthInput;
};


export type MutationLoginSessionCancelArgs = {
  code: Scalars['String']['input'];
};


export type MutationLoginSessionConsumeArgs = {
  code: Scalars['String']['input'];
};


export type MutationLoginSessionVerifyArgs = {
  code: Scalars['String']['input'];
};


export type MutationNotificationDeliveriesMarkAsReadArgs = {
  deliveryIds: Array<Scalars['String']['input']>;
};


export type MutationObservabilityDashboardCreateArgs = {
  input: ObservabilityDashboardCreateInput;
};


export type MutationObservabilityDashboardResetArgs = {
  id: Scalars['String']['input'];
};


export type MutationObservabilityDashboardUpdateArgs = {
  id: Scalars['String']['input'];
  input: Array<ObservabilityDashboardUpdateInput>;
};


export type MutationPasskeyDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationPluginCreateArgs = {
  input: PluginCreateInput;
};


export type MutationPluginDeleteArgs = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
};


export type MutationPluginResetArgs = {
  id: Scalars['String']['input'];
  input: ResetPluginInput;
};


export type MutationPluginResetCredentialsArgs = {
  id: Scalars['String']['input'];
  input: ResetPluginCredentialsInput;
};


export type MutationPluginRestartArgs = {
  id: Scalars['String']['input'];
  input: PluginRestartInput;
};


export type MutationPluginStartArgs = {
  id: Scalars['String']['input'];
  input: PluginRestartInput;
};


export type MutationPluginUpdateArgs = {
  id: Scalars['String']['input'];
  input: PluginUpdateInput;
};


export type MutationPreferencesUpdateArgs = {
  input: PreferencesUpdateData;
};


export type MutationPrivateNetworkCreateOrGetArgs = {
  input: PrivateNetworkCreateOrGetInput;
};


export type MutationPrivateNetworkEndpointCreateOrGetArgs = {
  input: PrivateNetworkEndpointCreateOrGetInput;
};


export type MutationPrivateNetworkEndpointDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationPrivateNetworkEndpointRenameArgs = {
  dnsName: Scalars['String']['input'];
  id: Scalars['String']['input'];
  privateNetworkId: Scalars['String']['input'];
};


export type MutationPrivateNetworksForEnvironmentDeleteArgs = {
  environmentId: Scalars['String']['input'];
};


export type MutationProjectClaimArgs = {
  id: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
};


export type MutationProjectCreateArgs = {
  input: ProjectCreateInput;
};


export type MutationProjectDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectFeatureFlagAddArgs = {
  input: ProjectFeatureFlagToggleInput;
};


export type MutationProjectFeatureFlagRemoveArgs = {
  input: ProjectFeatureFlagToggleInput;
};


export type MutationProjectInvitationAcceptArgs = {
  code: Scalars['String']['input'];
};


export type MutationProjectInvitationCreateArgs = {
  id: Scalars['String']['input'];
  input: ProjectInvitee;
};


export type MutationProjectInvitationDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectInvitationResendArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectInviteUserArgs = {
  id: Scalars['String']['input'];
  input: ProjectInviteUserInput;
};


export type MutationProjectLeaveArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectMemberRemoveArgs = {
  input: ProjectMemberRemoveInput;
};


export type MutationProjectMemberUpdateArgs = {
  input: ProjectMemberUpdateInput;
};


export type MutationProjectScheduleDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectScheduleDeleteCancelArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectScheduleDeleteForceArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectTokenCreateArgs = {
  input: ProjectTokenCreateInput;
};


export type MutationProjectTokenDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationProjectTransferArgs = {
  input: ProjectTransferInput;
  projectId: Scalars['String']['input'];
};


export type MutationProjectTransferConfirmArgs = {
  input: ProjectTransferConfirmInput;
};


export type MutationProjectTransferInitiateArgs = {
  input: ProjectTransferInitiateInput;
};


export type MutationProjectTransferToTeamArgs = {
  id: Scalars['String']['input'];
  input: ProjectTransferToTeamInput;
};


export type MutationProjectUpdateArgs = {
  id: Scalars['String']['input'];
  input: ProjectUpdateInput;
};


export type MutationProviderAuthRemoveArgs = {
  id: Scalars['String']['input'];
};


export type MutationRecoveryCodeValidateArgs = {
  input: RecoveryCodeValidateInput;
};


export type MutationReferralInfoUpdateArgs = {
  input: ReferralInfoUpdateInput;
};


export type MutationServiceConnectArgs = {
  id: Scalars['String']['input'];
  input: ServiceConnectInput;
};


export type MutationServiceCreateArgs = {
  input: ServiceCreateInput;
};


export type MutationServiceDeleteArgs = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
};


export type MutationServiceDisconnectArgs = {
  id: Scalars['String']['input'];
};


export type MutationServiceDomainCreateArgs = {
  input: ServiceDomainCreateInput;
};


export type MutationServiceDomainDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationServiceDomainUpdateArgs = {
  input: ServiceDomainUpdateInput;
};


export type MutationServiceDuplicateArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type MutationServiceFeatureFlagAddArgs = {
  input: ServiceFeatureFlagToggleInput;
};


export type MutationServiceFeatureFlagRemoveArgs = {
  input: ServiceFeatureFlagToggleInput;
};


export type MutationServiceInstanceDeployArgs = {
  commitSha?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  latestCommit?: InputMaybe<Scalars['Boolean']['input']>;
  serviceId: Scalars['String']['input'];
};


export type MutationServiceInstanceDeployV2Args = {
  commitSha?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type MutationServiceInstanceLimitsUpdateArgs = {
  input: ServiceInstanceLimitsUpdateInput;
};


export type MutationServiceInstanceRedeployArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type MutationServiceInstanceUpdateArgs = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  input: ServiceInstanceUpdateInput;
  serviceId: Scalars['String']['input'];
};


export type MutationServiceRemoveUpstreamUrlArgs = {
  id: Scalars['String']['input'];
};


export type MutationServiceUpdateArgs = {
  id: Scalars['String']['input'];
  input: ServiceUpdateInput;
};


export type MutationSessionDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationSharedVariableConfigureArgs = {
  input: SharedVariableConfigureInput;
};


export type MutationTcpProxyCreateArgs = {
  input: TcpProxyCreateInput;
};


export type MutationTcpProxyDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationTemplateCloneArgs = {
  input: TemplateCloneInput;
};


export type MutationTemplateDeleteArgs = {
  id: Scalars['String']['input'];
  input: TemplateDeleteInput;
};


export type MutationTemplateDeployArgs = {
  input: TemplateDeployInput;
};


export type MutationTemplateDeployV2Args = {
  input: TemplateDeployV2Input;
};


export type MutationTemplateGenerateArgs = {
  input: TemplateGenerateInput;
};


export type MutationTemplatePublishArgs = {
  id: Scalars['String']['input'];
  input: TemplatePublishInput;
};


export type MutationTemplateServiceSourceEjectArgs = {
  input: TemplateServiceSourceEjectInput;
};


export type MutationTemplateUnpublishArgs = {
  id: Scalars['String']['input'];
};


export type MutationTrustedDomainCreateArgs = {
  input: WorkspaceTrustedDomainCreateInput;
};


export type MutationTrustedDomainDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationTwoFactorInfoCreateArgs = {
  input: TwoFactorInfoCreateInput;
};


export type MutationTwoFactorInfoValidateArgs = {
  input: TwoFactorInfoValidateInput;
};


export type MutationUpsertSlackChannelArgs = {
  workspaceId: Scalars['String']['input'];
};


export type MutationUsageLimitRemoveArgs = {
  input: UsageLimitRemoveInput;
};


export type MutationUsageLimitSetArgs = {
  input: UsageLimitSetInput;
};


export type MutationUserFlagsRemoveArgs = {
  input: UserFlagsRemoveInput;
};


export type MutationUserFlagsSetArgs = {
  input: UserFlagsSetInput;
};


export type MutationUserProfileUpdateArgs = {
  input: UserProfileUpdateInput;
};


export type MutationVariableCollectionUpsertArgs = {
  input: VariableCollectionUpsertInput;
};


export type MutationVariableDeleteArgs = {
  input: VariableDeleteInput;
};


export type MutationVariableUpsertArgs = {
  input: VariableUpsertInput;
};


export type MutationVolumeCreateArgs = {
  input: VolumeCreateInput;
};


export type MutationVolumeDeleteArgs = {
  volumeId: Scalars['String']['input'];
};


export type MutationVolumeInstanceBackupCreateArgs = {
  name?: InputMaybe<Scalars['String']['input']>;
  volumeInstanceId: Scalars['String']['input'];
};


export type MutationVolumeInstanceBackupDeleteArgs = {
  volumeInstanceBackupId: Scalars['String']['input'];
  volumeInstanceId: Scalars['String']['input'];
};


export type MutationVolumeInstanceBackupLockArgs = {
  volumeInstanceBackupId: Scalars['String']['input'];
  volumeInstanceId: Scalars['String']['input'];
};


export type MutationVolumeInstanceBackupRestoreArgs = {
  volumeInstanceBackupId: Scalars['String']['input'];
  volumeInstanceId: Scalars['String']['input'];
};


export type MutationVolumeInstanceBackupScheduleUpdateArgs = {
  kinds: Array<VolumeInstanceBackupScheduleKind>;
  volumeInstanceId: Scalars['String']['input'];
};


export type MutationVolumeInstanceUpdateArgs = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  input: VolumeInstanceUpdateInput;
  volumeId: Scalars['String']['input'];
};


export type MutationVolumeUpdateArgs = {
  input: VolumeUpdateInput;
  volumeId: Scalars['String']['input'];
};


export type MutationWorkspaceDeleteArgs = {
  id: Scalars['String']['input'];
};


export type MutationWorkspaceInviteCodeCreateArgs = {
  input: WorkspaceInviteCodeCreateInput;
  workspaceId: Scalars['String']['input'];
};


export type MutationWorkspaceInviteCodeUseArgs = {
  code: Scalars['String']['input'];
};


export type MutationWorkspaceLeaveArgs = {
  id: Scalars['String']['input'];
};


export type MutationWorkspacePermissionChangeArgs = {
  input: WorkspacePermissionChangeInput;
};


export type MutationWorkspaceTwoFactorEnforcementUpdateArgs = {
  enabled: Scalars['Boolean']['input'];
  workspaceId: Scalars['String']['input'];
};


export type MutationWorkspaceUpdateArgs = {
  id: Scalars['String']['input'];
  input: WorkspaceUpdateInput;
};


export type MutationWorkspaceUpsertSlackChannelArgs = {
  id: Scalars['String']['input'];
};


export type MutationWorkspaceUserInviteArgs = {
  input: WorkspaceUserInviteInput;
  workspaceId: Scalars['String']['input'];
};


export type MutationWorkspaceUserRemoveArgs = {
  input: WorkspaceUserRemoveInput;
  workspaceId: Scalars['String']['input'];
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type NotificationDelivery = Node & {
  __typename?: 'NotificationDelivery';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  notificationInstance: NotificationInstance;
  readAt?: Maybe<Scalars['DateTime']['output']>;
  status: NotificationDeliveryStatus;
  type: NotificationDeliveryType;
  updatedAt: Scalars['DateTime']['output'];
  userId?: Maybe<Scalars['String']['output']>;
};

export type NotificationDeliveryCreated = {
  __typename?: 'NotificationDeliveryCreated';
  delivery: NotificationDelivery;
  type: Scalars['String']['output'];
};

export type NotificationDeliveryFilterInput = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  onlyUnread?: InputMaybe<Scalars['Boolean']['input']>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<NotificationStatus>;
  type?: InputMaybe<NotificationDeliveryType>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type NotificationDeliveryResolved = {
  __typename?: 'NotificationDeliveryResolved';
  deliveryIds: Array<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export enum NotificationDeliveryStatus {
  Failed = 'FAILED',
  Pending = 'PENDING',
  Sent = 'SENT'
}

export enum NotificationDeliveryType {
  Email = 'EMAIL',
  Inapp = 'INAPP',
  Webhook = 'WEBHOOK'
}

export type NotificationDeliveryUpdate = NotificationDeliveryCreated | NotificationDeliveryResolved;

export type NotificationInstance = Node & {
  __typename?: 'NotificationInstance';
  createdAt: Scalars['DateTime']['output'];
  environmentId?: Maybe<Scalars['String']['output']>;
  event: Event;
  eventId: Scalars['String']['output'];
  eventType?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  payload: Scalars['NotificationPayload']['output'];
  projectId?: Maybe<Scalars['String']['output']>;
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  resourceId?: Maybe<Scalars['String']['output']>;
  resourceType?: Maybe<Scalars['String']['output']>;
  serviceId?: Maybe<Scalars['String']['output']>;
  severity: NotificationSeverity;
  status: NotificationStatus;
  updatedAt: Scalars['DateTime']['output'];
  volumeId?: Maybe<Scalars['String']['output']>;
  workspaceId: Scalars['String']['output'];
};

export enum NotificationSeverity {
  Critical = 'CRITICAL',
  Info = 'INFO',
  Notice = 'NOTICE',
  Warning = 'WARNING'
}

export enum NotificationStatus {
  Active = 'ACTIVE',
  Resolved = 'RESOLVED'
}

export type ObservabilityDashboard = Node & {
  __typename?: 'ObservabilityDashboard';
  id: Scalars['ID']['output'];
  items: Array<ObservabilityDashboardItemInstance>;
};

export type ObservabilityDashboardAlert = Node & {
  __typename?: 'ObservabilityDashboardAlert';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  resourceId?: Maybe<Scalars['String']['output']>;
  resourceType: MonitorAlertResourceType;
  status: MonitorStatus;
};

export type ObservabilityDashboardCreateInput = {
  environmentId: Scalars['String']['input'];
  /** If no items are provided, a default dashboard will be created. */
  items?: InputMaybe<Array<ObservabilityDashboardUpdateInput>>;
};

export type ObservabilityDashboardItem = Node & {
  __typename?: 'ObservabilityDashboardItem';
  config: ObservabilityDashboardItemConfig;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  monitors: Array<ObservabilityDashboardMonitor>;
  name: Scalars['String']['output'];
  type: ObservabilityDashboardItemType;
};

export type ObservabilityDashboardItemConfig = {
  __typename?: 'ObservabilityDashboardItemConfig';
  logsFilter?: Maybe<Scalars['String']['output']>;
  measurements?: Maybe<Array<MetricMeasurement>>;
  projectUsageProperties?: Maybe<Array<ProjectUsageProperty>>;
  resourceIds?: Maybe<Array<Scalars['String']['output']>>;
};

export type ObservabilityDashboardItemConfigInput = {
  logsFilter?: InputMaybe<Scalars['String']['input']>;
  measurements?: InputMaybe<Array<MetricMeasurement>>;
  projectUsageProperties?: InputMaybe<Array<ProjectUsageProperty>>;
  resourceIds?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type ObservabilityDashboardItemCreateInput = {
  config: ObservabilityDashboardItemConfigInput;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  name: Scalars['String']['input'];
  type: ObservabilityDashboardItemType;
};

export type ObservabilityDashboardItemInstance = Node & {
  __typename?: 'ObservabilityDashboardItemInstance';
  dashboardItem: ObservabilityDashboardItem;
  displayConfig: Scalars['DisplayConfig']['output'];
  id: Scalars['ID']['output'];
};

export enum ObservabilityDashboardItemType {
  ProjectUsageItem = 'PROJECT_USAGE_ITEM',
  ServiceLogsItem = 'SERVICE_LOGS_ITEM',
  ServiceMetricsItem = 'SERVICE_METRICS_ITEM',
  VolumeMetricsItem = 'VOLUME_METRICS_ITEM'
}

export type ObservabilityDashboardMonitor = Node & {
  __typename?: 'ObservabilityDashboardMonitor';
  alerts: Array<ObservabilityDashboardAlert>;
  config: ObservabilityDashboardMonitorConfig;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
};


export type ObservabilityDashboardMonitorAlertsArgs = {
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
};

export type ObservabilityDashboardMonitorConfig = MonitorThresholdConfig;

export type ObservabilityDashboardUpdateInput = {
  dashboardItem: ObservabilityDashboardItemCreateInput;
  displayConfig: Scalars['DisplayConfig']['input'];
  id: Scalars['String']['input'];
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PartnerProfile = {
  __typename?: 'PartnerProfile';
  category: Scalars['String']['output'];
  description: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  type: PartnerProfileType;
  website: Scalars['String']['output'];
};

export enum PartnerProfileType {
  BasicPartner = 'BASIC_PARTNER',
  LimitedPartner = 'LIMITED_PARTNER',
  TemplateMaintainer = 'TEMPLATE_MAINTAINER'
}

export type Passkey = Node & {
  __typename?: 'Passkey';
  aaguid?: Maybe<Scalars['String']['output']>;
  backedUp: Scalars['Boolean']['output'];
  createdAt: Scalars['DateTime']['output'];
  credentialId: Scalars['String']['output'];
  deviceName: Scalars['String']['output'];
  deviceType: Scalars['String']['output'];
  displayName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastUsedAt?: Maybe<Scalars['DateTime']['output']>;
  lastUsedDevice?: Maybe<Scalars['String']['output']>;
  transports: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type PaymentMethod = {
  __typename?: 'PaymentMethod';
  card?: Maybe<PaymentMethodCard>;
  id: Scalars['String']['output'];
};

export type PaymentMethodCard = {
  __typename?: 'PaymentMethodCard';
  brand: Scalars['String']['output'];
  country?: Maybe<Scalars['String']['output']>;
  last4: Scalars['String']['output'];
};

export enum Plan {
  Free = 'FREE',
  Hobby = 'HOBBY',
  Pro = 'PRO'
}

export type PlanLimitOverride = Node & {
  __typename?: 'PlanLimitOverride';
  config: Scalars['SubscriptionPlanLimit']['output'];
  id: Scalars['ID']['output'];
};

export enum PlatformFeatureFlag {
  AllowReplicaMetrics = 'ALLOW_REPLICA_METRICS',
  BuilderV3RolloutExistingServices = 'BUILDER_V3_ROLLOUT_EXISTING_SERVICES',
  BuilderV3RolloutExistingServicesPro = 'BUILDER_V3_ROLLOUT_EXISTING_SERVICES_PRO',
  BuilderV3RolloutNewServices = 'BUILDER_V3_ROLLOUT_NEW_SERVICES',
  BuilderV3RolloutNewServicesPro = 'BUILDER_V3_ROLLOUT_NEW_SERVICES_PRO',
  CompareClickhouseMetrics = 'COMPARE_CLICKHOUSE_METRICS',
  CtrdImageStoreRollout = 'CTRD_IMAGE_STORE_ROLLOUT',
  DemoPercentageRollout = 'DEMO_PERCENTAGE_ROLLOUT',
  EnableRawSqlQueries = 'ENABLE_RAW_SQL_QUERIES',
  ScylladbRoutingEnabled = 'SCYLLADB_ROUTING_ENABLED',
  ServiceinstanceDataloaderForStaticUrl = 'SERVICEINSTANCE_DATALOADER_FOR_STATIC_URL',
  SplitUsageQueries = 'SPLIT_USAGE_QUERIES',
  TwoFactorEnforcementRollout = 'TWO_FACTOR_ENFORCEMENT_ROLLOUT',
  UpdatedVmQueries = 'UPDATED_VM_QUERIES',
  UseGhWebhooksForChangeDetection = 'USE_GH_WEBHOOKS_FOR_CHANGE_DETECTION',
  VmTimeRangeQuery = 'VM_TIME_RANGE_QUERY'
}

export type PlatformFeatureFlagStatus = {
  __typename?: 'PlatformFeatureFlagStatus';
  flag: PlatformFeatureFlag;
  rolloutPercentage: Scalars['Int']['output'];
  status: Scalars['Boolean']['output'];
  type: PlatformFeatureFlagType;
};

export enum PlatformFeatureFlagType {
  Boolean = 'BOOLEAN',
  Percentage = 'PERCENTAGE'
}

export type PlatformStatus = {
  __typename?: 'PlatformStatus';
  incident?: Maybe<Incident>;
  isStable: Scalars['Boolean']['output'];
  maintenance?: Maybe<Maintenance>;
};

export type Plugin = Node & {
  __typename?: 'Plugin';
  containers: PluginContainersConnection;
  createdAt: Scalars['DateTime']['output'];
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  deprecatedAt?: Maybe<Scalars['DateTime']['output']>;
  friendlyName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  logsEnabled: Scalars['Boolean']['output'];
  migrationDatabaseServiceId?: Maybe<Scalars['String']['output']>;
  name: PluginType;
  project: Project;
  status: PluginStatus;
  variables: PluginVariablesConnection;
};


export type PluginContainersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type PluginVariablesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type PluginContainersConnection = {
  __typename?: 'PluginContainersConnection';
  edges: Array<PluginContainersConnectionEdge>;
  pageInfo: PageInfo;
};

export type PluginContainersConnectionEdge = {
  __typename?: 'PluginContainersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Container;
};

export type PluginCreateInput = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  friendlyName?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type PluginRestartInput = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
};

export enum PluginStatus {
  Deprecated = 'DEPRECATED',
  Locked = 'LOCKED',
  Removed = 'REMOVED',
  Running = 'RUNNING',
  Stopped = 'STOPPED'
}

export enum PluginType {
  Mongodb = 'mongodb',
  Mysql = 'mysql',
  Postgresql = 'postgresql',
  Redis = 'redis'
}

export type PluginUpdateInput = {
  friendlyName: Scalars['String']['input'];
};

export type PluginVariablesConnection = {
  __typename?: 'PluginVariablesConnection';
  edges: Array<PluginVariablesConnectionEdge>;
  pageInfo: PageInfo;
};

export type PluginVariablesConnectionEdge = {
  __typename?: 'PluginVariablesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Variable;
};

export type Preferences = Node & {
  __typename?: 'Preferences';
  buildFailedEmail: Scalars['Boolean']['output'];
  changelogEmail: Scalars['Boolean']['output'];
  communityEmail: Scalars['Boolean']['output'];
  deployCrashedEmail: Scalars['Boolean']['output'];
  ephemeralEnvironmentEmail: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  marketingEmail: Scalars['Boolean']['output'];
  subprocessorUpdatesEmail: Scalars['Boolean']['output'];
  templateQueueEmail: Scalars['Boolean']['output'];
  usageEmail: Scalars['Boolean']['output'];
};

export type PreferencesUpdateData = {
  buildFailedEmail?: InputMaybe<Scalars['Boolean']['input']>;
  changelogEmail?: InputMaybe<Scalars['Boolean']['input']>;
  communityEmail?: InputMaybe<Scalars['Boolean']['input']>;
  deployCrashedEmail?: InputMaybe<Scalars['Boolean']['input']>;
  ephemeralEnvironmentEmail?: InputMaybe<Scalars['Boolean']['input']>;
  marketingEmail?: InputMaybe<Scalars['Boolean']['input']>;
  subprocessorUpdatesEmail?: InputMaybe<Scalars['Boolean']['input']>;
  templateQueueEmail?: InputMaybe<Scalars['Boolean']['input']>;
  token?: InputMaybe<Scalars['String']['input']>;
  usageEmail?: InputMaybe<Scalars['Boolean']['input']>;
};

export type PrivateNetwork = {
  __typename?: 'PrivateNetwork';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  dnsName: Scalars['String']['output'];
  environmentId: Scalars['String']['output'];
  name: Scalars['String']['output'];
  networkId: Scalars['BigInt']['output'];
  projectId: Scalars['String']['output'];
  publicId: Scalars['String']['output'];
  tags: Array<Scalars['String']['output']>;
};

export type PrivateNetworkCreateOrGetInput = {
  environmentId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  tags: Array<Scalars['String']['input']>;
};

export type PrivateNetworkEndpoint = {
  __typename?: 'PrivateNetworkEndpoint';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  dnsName: Scalars['String']['output'];
  privateIps: Array<Scalars['String']['output']>;
  publicId: Scalars['String']['output'];
  serviceInstanceId: Scalars['String']['output'];
  tags: Array<Scalars['String']['output']>;
};

export type PrivateNetworkEndpointCreateOrGetInput = {
  environmentId: Scalars['String']['input'];
  privateNetworkId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  serviceName: Scalars['String']['input'];
  tags: Array<Scalars['String']['input']>;
};

export type Project = Node & {
  __typename?: 'Project';
  baseEnvironment?: Maybe<Environment>;
  baseEnvironmentId?: Maybe<Scalars['String']['output']>;
  botPrEnvironments: Scalars['Boolean']['output'];
  buckets: ProjectBucketsConnection;
  createdAt: Scalars['DateTime']['output'];
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  /** @deprecated Use environment.deploymentTriggers for properly scoped access control */
  deploymentTriggers: ProjectDeploymentTriggersConnection;
  /** @deprecated Use environment.deployments for properly scoped access control */
  deployments: ProjectDeploymentsConnection;
  description?: Maybe<Scalars['String']['output']>;
  environments: ProjectEnvironmentsConnection;
  expiredAt?: Maybe<Scalars['DateTime']['output']>;
  featureFlags: Array<ActiveProjectFeatureFlag>;
  groups: ProjectGroupsConnection;
  id: Scalars['ID']['output'];
  isPublic: Scalars['Boolean']['output'];
  isTempProject: Scalars['Boolean']['output'];
  members: Array<ProjectMember>;
  name: Scalars['String']['output'];
  /** @deprecated Plugins have been removed */
  plugins: ProjectPluginsConnection;
  prDeploys: Scalars['Boolean']['output'];
  projectPermissions: ProjectProjectPermissionsConnection;
  services: ProjectServicesConnection;
  subscriptionPlanLimit: Scalars['SubscriptionPlanLimit']['output'];
  subscriptionType: SubscriptionPlanType;
  /** @deprecated Use workspace */
  team?: Maybe<Team>;
  /** @deprecated Use workspaceId */
  teamId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  volumes: ProjectVolumesConnection;
  workspace?: Maybe<Workspace>;
  workspaceId?: Maybe<Scalars['String']['output']>;
};


export type ProjectBucketsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectDeploymentTriggersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectDeploymentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectEnvironmentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  isEphemeral?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<SortOrder>;
};


export type ProjectGroupsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectPluginsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectProjectPermissionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectServicesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ProjectVolumesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type ProjectBucketsConnection = {
  __typename?: 'ProjectBucketsConnection';
  edges: Array<ProjectBucketsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectBucketsConnectionEdge = {
  __typename?: 'ProjectBucketsConnectionEdge';
  cursor: Scalars['String']['output'];
};

export type ProjectComplianceInfo = {
  __typename?: 'ProjectComplianceInfo';
  /** Permissions for each project member */
  memberPermissions: Array<ProjectMemberPermissionsInfo>;
  projectId: Scalars['String']['output'];
  projectName: Scalars['String']['output'];
  /** Backup schedules for database services */
  serviceBackups: Array<ServiceBackupInfo>;
  /** 2FA status for each project member */
  twoFactorMembers: Array<ProjectMemberTwoFactorInfo>;
  workspaceId: Scalars['String']['output'];
};

export type ProjectCreateInput = {
  defaultEnvironmentName?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isMonorepo?: InputMaybe<Scalars['Boolean']['input']>;
  isPublic?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  prDeploys?: InputMaybe<Scalars['Boolean']['input']>;
  repo?: InputMaybe<ProjectCreateRepo>;
  runtime?: InputMaybe<PublicRuntime>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type ProjectCreateRepo = {
  branch: Scalars['String']['input'];
  fullRepoName: Scalars['String']['input'];
};

export type ProjectDeploymentTriggersConnection = {
  __typename?: 'ProjectDeploymentTriggersConnection';
  edges: Array<ProjectDeploymentTriggersConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectDeploymentTriggersConnectionEdge = {
  __typename?: 'ProjectDeploymentTriggersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: DeploymentTrigger;
};

export type ProjectDeploymentsConnection = {
  __typename?: 'ProjectDeploymentsConnection';
  edges: Array<ProjectDeploymentsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectDeploymentsConnectionEdge = {
  __typename?: 'ProjectDeploymentsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Deployment;
};

export type ProjectEnvironmentsConnection = {
  __typename?: 'ProjectEnvironmentsConnection';
  edges: Array<ProjectEnvironmentsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectEnvironmentsConnectionEdge = {
  __typename?: 'ProjectEnvironmentsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Environment;
};

export type ProjectFeatureFlagToggleInput = {
  flag: ActiveProjectFeatureFlag;
  projectId: Scalars['String']['input'];
};

export type ProjectGroupsConnection = {
  __typename?: 'ProjectGroupsConnection';
  edges: Array<ProjectGroupsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectGroupsConnectionEdge = {
  __typename?: 'ProjectGroupsConnectionEdge';
  cursor: Scalars['String']['output'];
};

export type ProjectInvitation = {
  __typename?: 'ProjectInvitation';
  email: Scalars['String']['output'];
  expiresAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  inviter?: Maybe<ProjectInvitationInviter>;
  isExpired: Scalars['Boolean']['output'];
  project: PublicProjectInformation;
};

export type ProjectInvitationInviter = {
  __typename?: 'ProjectInvitationInviter';
  email: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
};

export type ProjectInviteUserInput = {
  email: Scalars['String']['input'];
  link: Scalars['String']['input'];
};

export type ProjectInvitee = {
  email: Scalars['String']['input'];
  role: ProjectRole;
};

export type ProjectMember = {
  __typename?: 'ProjectMember';
  avatar?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  role: ProjectRole;
};

export type ProjectMemberPermissionsInfo = {
  __typename?: 'ProjectMemberPermissionsInfo';
  email: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  role: ProjectRole;
};

export type ProjectMemberRemoveInput = {
  projectId: Scalars['String']['input'];
  userId: Scalars['String']['input'];
};

export type ProjectMemberTwoFactorInfo = {
  __typename?: 'ProjectMemberTwoFactorInfo';
  email: Scalars['String']['output'];
  /** List of enabled 2FA methods (AUTHENTICATOR, PASSKEY) */
  enabledMethods: Array<TwoFactorMethodCompliance>;
  name?: Maybe<Scalars['String']['output']>;
  twoFactorAuthEnabled: Scalars['Boolean']['output'];
};

export type ProjectMemberUpdateInput = {
  projectId: Scalars['String']['input'];
  role: ProjectRole;
  userId: Scalars['String']['input'];
};

export type ProjectPermission = Node & {
  __typename?: 'ProjectPermission';
  id: Scalars['ID']['output'];
  projectId: Scalars['String']['output'];
  role: ProjectRole;
  userId: Scalars['String']['output'];
};

export type ProjectPluginsConnection = {
  __typename?: 'ProjectPluginsConnection';
  edges: Array<ProjectPluginsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectPluginsConnectionEdge = {
  __typename?: 'ProjectPluginsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Plugin;
};

export type ProjectProjectPermissionsConnection = {
  __typename?: 'ProjectProjectPermissionsConnection';
  edges: Array<ProjectProjectPermissionsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectProjectPermissionsConnectionEdge = {
  __typename?: 'ProjectProjectPermissionsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ProjectPermission;
};

export type ProjectResourceAccess = {
  __typename?: 'ProjectResourceAccess';
  customDomain: AccessRule;
  databaseDeployment: AccessRule;
  deployment: AccessRule;
  environment: AccessRule;
  /** @deprecated Plugins have been removed */
  plugin: AccessRule;
};

export enum ProjectRole {
  Admin = 'ADMIN',
  Member = 'MEMBER',
  Viewer = 'VIEWER'
}

export type ProjectServicesConnection = {
  __typename?: 'ProjectServicesConnection';
  edges: Array<ProjectServicesConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectServicesConnectionEdge = {
  __typename?: 'ProjectServicesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Service;
};

export type ProjectToken = Node & {
  __typename?: 'ProjectToken';
  createdAt: Scalars['DateTime']['output'];
  displayToken: Scalars['String']['output'];
  environment: Environment;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  project: Project;
  projectId: Scalars['String']['output'];
};

export type ProjectTokenCreateInput = {
  environmentId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type ProjectTransferConfirmInput = {
  destinationWorkspaceId?: InputMaybe<Scalars['String']['input']>;
  ownershipTransferId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type ProjectTransferInitiateInput = {
  memberId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type ProjectTransferInput = {
  workspaceId: Scalars['String']['input'];
};

export type ProjectTransferToTeamInput = {
  teamId: Scalars['String']['input'];
};

export type ProjectUpdateInput = {
  baseEnvironmentId?: InputMaybe<Scalars['String']['input']>;
  /** Enable/disable pull request environments for PRs created by bots */
  botPrEnvironments?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isPublic?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  prDeploys?: InputMaybe<Scalars['Boolean']['input']>;
};

export enum ProjectUsageProperty {
  BackupUsage = 'BACKUP_USAGE',
  CpuUsage = 'CPU_USAGE',
  CurrentUsage = 'CURRENT_USAGE',
  DiskUsage = 'DISK_USAGE',
  EstimatedUsage = 'ESTIMATED_USAGE',
  MemoryUsage = 'MEMORY_USAGE',
  NetworkUsage = 'NETWORK_USAGE'
}

export type ProjectVolumesConnection = {
  __typename?: 'ProjectVolumesConnection';
  edges: Array<ProjectVolumesConnectionEdge>;
  pageInfo: PageInfo;
};

export type ProjectVolumesConnectionEdge = {
  __typename?: 'ProjectVolumesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Volume;
};

export type ProjectWorkspaceMember = {
  __typename?: 'ProjectWorkspaceMember';
  email: Scalars['String']['output'];
  /** List of enabled 2FA methods (AUTHENTICATOR, PASSKEY) */
  enabledMethods: Array<TwoFactorMethodProjectWorkspace>;
  name?: Maybe<Scalars['String']['output']>;
  twoFactorAuthEnabled: Scalars['Boolean']['output'];
};

export type ProjectWorkspaceMembersResponse = {
  __typename?: 'ProjectWorkspaceMembersResponse';
  members: Array<ProjectWorkspaceMember>;
  projectId: Scalars['String']['output'];
  projectName: Scalars['String']['output'];
  workspaceId: Scalars['String']['output'];
};

export type ProviderAuth = Node & {
  __typename?: 'ProviderAuth';
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isAuthEnabled: Scalars['Boolean']['output'];
  metadata: Scalars['JSON']['output'];
  provider: Scalars['String']['output'];
  userId: Scalars['String']['output'];
};

export type PublicProjectInformation = {
  __typename?: 'PublicProjectInformation';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type PublicProjectInvitation = InviteCode | ProjectInvitation;

export enum PublicRuntime {
  Legacy = 'LEGACY',
  Unspecified = 'UNSPECIFIED',
  V2 = 'V2'
}

export type PublicStats = {
  __typename?: 'PublicStats';
  totalDeploymentsLastMonth: Scalars['Int']['output'];
  totalLogsLastMonth: Scalars['BigInt']['output'];
  totalProjects: Scalars['Int']['output'];
  totalRequestsLastMonth: Scalars['BigInt']['output'];
  totalServices: Scalars['Int']['output'];
  totalUsers: Scalars['Int']['output'];
};

export type Query = {
  __typename?: 'Query';
  /** Get all volume instances for a given volume */
  adminVolumeInstancesForVolume: Array<VolumeInstance>;
  /** Returns the platform feature flags enabled for the current user */
  allPlatformFeatureFlags: Array<PlatformFeatureFlagStatus>;
  /** Introspect the current API token and its accessible workspaces. */
  apiToken: ApiTokenContext;
  /** Gets all API tokens for the authenticated user. */
  apiTokens: QueryApiTokensConnection;
  /** Get an audit log by ID */
  auditLog: AuditLog;
  /** Get a list of all audit log event types and their description */
  auditLogEventTypeInfo: Array<AuditLogEventTypeInfo>;
  /** Gets audit logs for a workspace. */
  auditLogs: QueryAuditLogsConnection;
  /** Fetch logs for a build */
  buildLogs: Array<Log>;
  /** Gets the image URL for a Notion image block */
  changelogBlockImage: Scalars['String']['output'];
  /** Get compliance agreements for a workspace including HIPAA BAA and GDPR DPA status. */
  complianceAgreements: ComplianceAgreementsInfo;
  /** Fetch details for a custom domain */
  customDomain: CustomDomain;
  /** Checks if a custom domain is available. */
  customDomainAvailable: DomainAvailable;
  /** Find a single deployment */
  deployment: Deployment;
  /** Get the deployment events for a deployment */
  deploymentEvents: QueryDeploymentEventsConnection;
  /** Get the deployment instance executions for a deployment. */
  deploymentInstanceExecutions: QueryDeploymentInstanceExecutionsConnection;
  /** Fetch logs for a deployment */
  deploymentLogs: Array<Log>;
  /** Find a single DeploymentSnapshot */
  deploymentSnapshot?: Maybe<DeploymentSnapshot>;
  /** All deployment triggers. */
  deploymentTriggers: QueryDeploymentTriggersConnection;
  /** Get all deployments */
  deployments: QueryDeploymentsConnection;
  /**
   * Domain with status
   * @deprecated Use the `status` field within the `domain` query instead
   */
  domainStatus: DomainWithStatus;
  /** All domains for a service instance */
  domains: AllDomains;
  /** All egress gateways assigned to a service instance */
  egressGateways: Array<EgressGateway>;
  /** Find a single environment */
  environment: Environment;
  /** Fetch logs for a project environment. Build logs are excluded unless a snapshot ID is explicitly provided in the filter */
  environmentLogs: Array<Log>;
  /** Get a single environment patch by ID */
  environmentPatch: EnvironmentPatch;
  /** Get the patches for an environment */
  environmentPatches: QueryEnvironmentPatchesConnection;
  /** Get the latest staged commit for a single environment. */
  environmentStagedChanges: EnvironmentPatch;
  /** Gets all environments for a project. */
  environments: QueryEnvironmentsConnection;
  /** Get the estimated total cost of the project at the end of the current billing cycle. If no `startDate` is provided, the usage for the current billing period of the project owner is returned. */
  estimatedUsage: Array<EstimatedUsage>;
  /** Gets the events for a project. */
  events: QueryEventsConnection;
  /** Get the workspaces the user doesn't belong to, but needs access (like when invited to a project) */
  externalWorkspaces: Array<ExternalWorkspace>;
  /** Get information about a specific function runtime */
  functionRuntime: FunctionRuntime;
  /** List available function runtimes */
  functionRuntimes: Array<FunctionRuntime>;
  /** Checks if user has access to GitHub repository */
  gitHubRepoAccessAvailable: GitHubAccess;
  /** Check if a repo name is available */
  githubIsRepoNameAvailable: Scalars['Boolean']['output'];
  /** Checks if user has access to GitHub repository */
  githubRepo: GitHubRepoWithoutInstallation;
  /** Get branches for a GitHub repo that the authenticated user has access to */
  githubRepoBranches: Array<GitHubBranch>;
  /** Get a list of repos for a user that Railway has access to */
  githubRepos: Array<GitHubRepo>;
  /** Get a list of scopes the user has installed the installation to */
  githubWritableScopes: Array<Scalars['String']['output']>;
  /** Get the Herokus apps for the current user */
  herokuApps: Array<HerokuApp>;
  /** Fetch HTTP logs for a deployment */
  httpLogs: Array<HttpLog>;
  /** Get an integration auth by provider providerId */
  integrationAuth: IntegrationAuth;
  /** Get all integration auths for a user */
  integrationAuths: QueryIntegrationAuthsConnection;
  /** Get all integrations for a project */
  integrations: QueryIntegrationsConnection;
  /** Get an invite code by the code */
  inviteCode: InviteCode;
  /** Gets the authenticated user. */
  me: User;
  /** Get metrics for a project, environment, and service */
  metrics: Array<MetricsResult>;
  /** Gets notification deliveries for the authenticated user */
  notificationDeliveries: QueryNotificationDeliveriesConnection;
  /** Get all observability dashboards for an environment */
  observabilityDashboards: QueryObservabilityDashboardsConnection;
  /** Gets all passkeys for the authenticated user */
  passkeys: QueryPasskeysConnection;
  /** Get the current status of the platform */
  platformStatus: PlatformStatus;
  /**
   * Get a plugin by ID.
   * @deprecated Plugins are deprecated
   */
  plugin: Plugin;
  /**
   * Fetch logs for a plugin
   * @deprecated Plugins are deprecated
   */
  pluginLogs: Array<Log>;
  /** Get the email preferences for a user */
  preferences: Preferences;
  /** Get a private network endpoint for a service instance. */
  privateNetworkEndpoint?: Maybe<PrivateNetworkEndpoint>;
  /** Check if an endpoint name is available. */
  privateNetworkEndpointNameAvailable: Scalars['Boolean']['output'];
  /** List private networks for an environment. */
  privateNetworks: Array<PrivateNetwork>;
  /** Get a project by ID */
  project: Project;
  /** Get comprehensive compliance information for a project including 2FA status, member permissions, backup schedules, and compliance agreements. Requires workspace API token with admin access. */
  projectCompliance: ProjectComplianceInfo;
  /** Get a project invitation by code */
  projectInvitation: PublicProjectInvitation;
  /** Get invitations for a project */
  projectInvitations: Array<ProjectInvitation>;
  /** Get an invite code for a project for a specifc role */
  projectInviteCode: InviteCode;
  /** Gets users who belong to a project along with their role */
  projectMembers: Array<ProjectMember>;
  /** Get resource access rules for project-specific actions */
  projectResourceAccess: ProjectResourceAccess;
  /** Get a single project token by the value in the header */
  projectToken: ProjectToken;
  /** Get all project tokens for a project */
  projectTokens: QueryProjectTokensConnection;
  /** Get workspace members for a project with 2FA details */
  projectWorkspaceMembers: ProjectWorkspaceMembersResponse;
  /** Gets all projects for a user or workspace. */
  projects: QueryProjectsConnection;
  /** Get public Railway stats. */
  publicStats: PublicStats;
  /** Gets the ReferralInfo for the authenticated user. */
  referralInfo: ReferralInfo;
  /** List available regions */
  regions: Array<Region>;
  /** Get resource access for the current user or workspace */
  resourceAccess: ResourceAccess;
  /** Get a service by ID */
  service: Service;
  /** Checks if a service domain is available */
  serviceDomainAvailable: DomainAvailable;
  /** Get a service instance belonging to a service and environment */
  serviceInstance: ServiceInstance;
  /** Check if the upstream repo for a service has an update available */
  serviceInstanceIsUpdatable: Scalars['Boolean']['output'];
  /** Get the service instance resource limit overrides (null if no overrides set) */
  serviceInstanceLimitOverride?: Maybe<Scalars['ServiceInstanceLimit']['output']>;
  /** Get the merged resource limits for a service instance (includes plan defaults) */
  serviceInstanceLimits: Scalars['ServiceInstanceLimit']['output'];
  /** Gets all sessions for authenticated user. */
  sessions: QuerySessionsConnection;
  /** All TCP proxies for a service instance */
  tcpProxies: Array<TcpProxy>;
  /**
   * Find a team by ID
   * @deprecated Teams are now workspaces. Use the workspace query instead.
   */
  team: Team;
  /**
   * Get all templates for a team.
   * @deprecated Use templates instead - teams are now workspaces
   */
  teamTemplates: QueryTeamTemplatesConnection;
  /** Get a template by code or ID or GitHub owner and repo. */
  template: Template;
  /** Get the metrics for a template. */
  templateMetrics: TemplateMetrics;
  /** Get the source template for a project. */
  templateSourceForProject?: Maybe<Template>;
  /** Get all published templates. */
  templates: QueryTemplatesConnection;
  /** Count all published templates. */
  templatesCount: Scalars['Int']['output'];
  /** Get all trusted domains for a workspace */
  trustedDomains: QueryTrustedDomainsConnection;
  /** Gets the TwoFactorInfo for the authenticated user. */
  twoFactorInfo: TwoFactorInfo;
  /** Get the usage for a single project or all projects for a user/workspace. If no `projectId` or `workspaceId` is provided, the usage for the current user is returned. If no `startDate` is provided, the usage for the current billing period of the project owner is returned. */
  usage: Array<AggregatedUsage>;
  /**
   * Get the total kickback earnings for a user.
   * @deprecated This field is deprecated and will be removed in future versions.
   */
  userKickbackEarnings: UserKickbackEarnings;
  /** Get the public profile for a user */
  userProfile: UserProfileResponse;
  /**
   * Get all templates for the current user.
   * @deprecated Users don't have personal templates anymore, they belong to their team now
   */
  userTemplates: QueryUserTemplatesConnection;
  /** All variables by pluginId or serviceId. If neither are provided, all shared variables are returned. */
  variables: Scalars['EnvironmentVariables']['output'];
  /** All rendered variables that are required for a service deployment. */
  variablesForServiceDeployment: Scalars['EnvironmentVariables']['output'];
  /** Get information about the user's Vercel accounts */
  vercelInfo: VercelInfo;
  /** Get a single volume instance by id */
  volumeInstance: VolumeInstance;
  /** List backups of a volume instance */
  volumeInstanceBackupList: Array<VolumeInstanceBackup>;
  /** List backups schedules of a volume instance */
  volumeInstanceBackupScheduleList: Array<VolumeInstanceBackupSchedule>;
  /** Gets the status of a workflow */
  workflowStatus: WorkflowResult;
  /** Get the workspace */
  workspace: Workspace;
  /** Find a workspace by invite code */
  workspaceByCode: Workspace;
  /** Gets all identity providers of a workspace */
  workspaceIdentityProviders: QueryWorkspaceIdentityProvidersConnection;
  /** Get all templates for a workspace. */
  workspaceTemplates: QueryWorkspaceTemplatesConnection;
};


export type QueryAdminVolumeInstancesForVolumeArgs = {
  volumeId: Scalars['String']['input'];
};


export type QueryApiTokensArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryAuditLogArgs = {
  id: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
};


export type QueryAuditLogsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AuditLogFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  sort?: InputMaybe<SortOrder>;
  workspaceId: Scalars['String']['input'];
};


export type QueryBuildLogsArgs = {
  deploymentId: Scalars['String']['input'];
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
};


export type QueryChangelogBlockImageArgs = {
  id: Scalars['String']['input'];
};


export type QueryComplianceAgreementsArgs = {
  workspaceId: Scalars['String']['input'];
};


export type QueryCustomDomainArgs = {
  id: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type QueryCustomDomainAvailableArgs = {
  domain: Scalars['String']['input'];
};


export type QueryDeploymentArgs = {
  id: Scalars['String']['input'];
};


export type QueryDeploymentEventsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  id: Scalars['String']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDeploymentInstanceExecutionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  input: DeploymentInstanceExecutionListInput;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDeploymentLogsArgs = {
  deploymentId: Scalars['String']['input'];
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
};


export type QueryDeploymentSnapshotArgs = {
  deploymentId: Scalars['String']['input'];
};


export type QueryDeploymentTriggersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryDeploymentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  input: DeploymentListInput;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDomainStatusArgs = {
  id: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};


export type QueryDomainsArgs = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryEgressGatewaysArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryEnvironmentArgs = {
  id: Scalars['String']['input'];
  projectId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryEnvironmentLogsArgs = {
  afterDate?: InputMaybe<Scalars['String']['input']>;
  afterLimit?: InputMaybe<Scalars['Int']['input']>;
  anchorDate?: InputMaybe<Scalars['String']['input']>;
  beforeDate?: InputMaybe<Scalars['String']['input']>;
  beforeLimit?: InputMaybe<Scalars['Int']['input']>;
  environmentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
};


export type QueryEnvironmentPatchArgs = {
  id: Scalars['String']['input'];
};


export type QueryEnvironmentPatchesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryEnvironmentStagedChangesArgs = {
  environmentId: Scalars['String']['input'];
};


export type QueryEnvironmentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  isEphemeral?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
};


export type QueryEstimatedUsageArgs = {
  includeDeleted?: InputMaybe<Scalars['Boolean']['input']>;
  measurements: Array<MetricMeasurement>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryEventsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  environmentId?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<EventFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
};


export type QueryExternalWorkspacesArgs = {
  projectId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryFunctionRuntimeArgs = {
  name: FunctionRuntimeName;
};


export type QueryGitHubRepoAccessAvailableArgs = {
  fullRepoName: Scalars['String']['input'];
};


export type QueryGithubIsRepoNameAvailableArgs = {
  fullRepoName: Scalars['String']['input'];
};


export type QueryGithubRepoArgs = {
  fullRepoName: Scalars['String']['input'];
};


export type QueryGithubRepoBranchesArgs = {
  owner: Scalars['String']['input'];
  repo: Scalars['String']['input'];
};


export type QueryHttpLogsArgs = {
  afterDate?: InputMaybe<Scalars['String']['input']>;
  afterLimit?: InputMaybe<Scalars['Int']['input']>;
  anchorDate?: InputMaybe<Scalars['String']['input']>;
  beforeDate?: InputMaybe<Scalars['String']['input']>;
  beforeLimit?: InputMaybe<Scalars['Int']['input']>;
  deploymentId: Scalars['String']['input'];
  endDate?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  startDate?: InputMaybe<Scalars['String']['input']>;
};


export type QueryIntegrationAuthArgs = {
  provider: Scalars['String']['input'];
  providerId: Scalars['String']['input'];
};


export type QueryIntegrationAuthsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryIntegrationsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
};


export type QueryInviteCodeArgs = {
  code: Scalars['String']['input'];
};


export type QueryMetricsArgs = {
  averagingWindowSeconds?: InputMaybe<Scalars['Int']['input']>;
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  environmentId?: InputMaybe<Scalars['String']['input']>;
  groupBy?: InputMaybe<Array<MetricTag>>;
  includeDeleted?: InputMaybe<Scalars['Boolean']['input']>;
  measurements: Array<MetricMeasurement>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  sampleRateSeconds?: InputMaybe<Scalars['Int']['input']>;
  serviceId?: InputMaybe<Scalars['String']['input']>;
  startDate: Scalars['DateTime']['input'];
  volumeId?: InputMaybe<Scalars['String']['input']>;
  volumeInstanceExternalId?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryNotificationDeliveriesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<NotificationDeliveryFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryObservabilityDashboardsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPasskeysArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPluginArgs = {
  id: Scalars['String']['input'];
};


export type QueryPluginLogsArgs = {
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  environmentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  pluginId: Scalars['String']['input'];
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
};


export type QueryPreferencesArgs = {
  token?: InputMaybe<Scalars['String']['input']>;
};


export type QueryPrivateNetworkEndpointArgs = {
  environmentId: Scalars['String']['input'];
  privateNetworkId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryPrivateNetworkEndpointNameAvailableArgs = {
  environmentId: Scalars['String']['input'];
  prefix: Scalars['String']['input'];
  privateNetworkId: Scalars['String']['input'];
};


export type QueryPrivateNetworksArgs = {
  environmentId: Scalars['String']['input'];
};


export type QueryProjectArgs = {
  id: Scalars['String']['input'];
};


export type QueryProjectComplianceArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryProjectInvitationArgs = {
  code: Scalars['String']['input'];
};


export type QueryProjectInvitationsArgs = {
  id: Scalars['String']['input'];
};


export type QueryProjectInviteCodeArgs = {
  projectId: Scalars['String']['input'];
  role: ProjectRole;
};


export type QueryProjectMembersArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryProjectResourceAccessArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryProjectTokensArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  projectId: Scalars['String']['input'];
};


export type QueryProjectWorkspaceMembersArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryProjectsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  includeDeleted?: InputMaybe<Scalars['Boolean']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  userId?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryReferralInfoArgs = {
  workspaceId: Scalars['String']['input'];
};


export type QueryRegionsArgs = {
  projectId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryResourceAccessArgs = {
  explicitResourceOwner: ExplicitOwnerInput;
};


export type QueryServiceArgs = {
  id: Scalars['String']['input'];
};


export type QueryServiceDomainAvailableArgs = {
  domain: Scalars['String']['input'];
};


export type QueryServiceInstanceArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryServiceInstanceIsUpdatableArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryServiceInstanceLimitOverrideArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryServiceInstanceLimitsArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QuerySessionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryTcpProxiesArgs = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryTeamArgs = {
  id: Scalars['String']['input'];
};


export type QueryTeamTemplatesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  teamId: Scalars['String']['input'];
};


export type QueryTemplateArgs = {
  code?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['String']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  repo?: InputMaybe<Scalars['String']['input']>;
};


export type QueryTemplateMetricsArgs = {
  id: Scalars['String']['input'];
};


export type QueryTemplateSourceForProjectArgs = {
  projectId: Scalars['String']['input'];
};


export type QueryTemplatesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  recommended?: InputMaybe<Scalars['Boolean']['input']>;
  verified?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryTrustedDomainsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  workspaceId: Scalars['String']['input'];
};


export type QueryUsageArgs = {
  endDate?: InputMaybe<Scalars['DateTime']['input']>;
  groupBy?: InputMaybe<Array<MetricTag>>;
  includeDeleted?: InputMaybe<Scalars['Boolean']['input']>;
  measurements: Array<MetricMeasurement>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  startDate?: InputMaybe<Scalars['DateTime']['input']>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryUserKickbackEarningsArgs = {
  userId: Scalars['String']['input'];
};


export type QueryUserProfileArgs = {
  username: Scalars['String']['input'];
};


export type QueryUserTemplatesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryVariablesArgs = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId?: InputMaybe<Scalars['String']['input']>;
  unrendered?: InputMaybe<Scalars['Boolean']['input']>;
};


export type QueryVariablesForServiceDeploymentArgs = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};


export type QueryVolumeInstanceArgs = {
  id: Scalars['String']['input'];
};


export type QueryVolumeInstanceBackupListArgs = {
  volumeInstanceId: Scalars['String']['input'];
};


export type QueryVolumeInstanceBackupScheduleListArgs = {
  volumeInstanceId: Scalars['String']['input'];
};


export type QueryWorkflowStatusArgs = {
  workflowId: Scalars['String']['input'];
};


export type QueryWorkspaceArgs = {
  workspaceId: Scalars['String']['input'];
};


export type QueryWorkspaceByCodeArgs = {
  code: Scalars['String']['input'];
};


export type QueryWorkspaceIdentityProvidersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  workspaceId: Scalars['String']['input'];
};


export type QueryWorkspaceTemplatesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  workspaceId: Scalars['String']['input'];
};

export type QueryApiTokensConnection = {
  __typename?: 'QueryApiTokensConnection';
  edges: Array<QueryApiTokensConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryApiTokensConnectionEdge = {
  __typename?: 'QueryApiTokensConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ApiToken;
};

export type QueryAuditLogsConnection = {
  __typename?: 'QueryAuditLogsConnection';
  edges: Array<QueryAuditLogsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryAuditLogsConnectionEdge = {
  __typename?: 'QueryAuditLogsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: AuditLog;
};

export type QueryDeploymentEventsConnection = {
  __typename?: 'QueryDeploymentEventsConnection';
  edges: Array<QueryDeploymentEventsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryDeploymentEventsConnectionEdge = {
  __typename?: 'QueryDeploymentEventsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: DeploymentEvent;
};

export type QueryDeploymentInstanceExecutionsConnection = {
  __typename?: 'QueryDeploymentInstanceExecutionsConnection';
  edges: Array<QueryDeploymentInstanceExecutionsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryDeploymentInstanceExecutionsConnectionEdge = {
  __typename?: 'QueryDeploymentInstanceExecutionsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: DeploymentInstanceExecution;
};

export type QueryDeploymentTriggersConnection = {
  __typename?: 'QueryDeploymentTriggersConnection';
  edges: Array<QueryDeploymentTriggersConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryDeploymentTriggersConnectionEdge = {
  __typename?: 'QueryDeploymentTriggersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: DeploymentTrigger;
};

export type QueryDeploymentsConnection = {
  __typename?: 'QueryDeploymentsConnection';
  edges: Array<QueryDeploymentsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryDeploymentsConnectionEdge = {
  __typename?: 'QueryDeploymentsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Deployment;
};

export type QueryEnvironmentPatchesConnection = {
  __typename?: 'QueryEnvironmentPatchesConnection';
  edges: Array<QueryEnvironmentPatchesConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryEnvironmentPatchesConnectionEdge = {
  __typename?: 'QueryEnvironmentPatchesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: EnvironmentPatch;
};

export type QueryEnvironmentsConnection = {
  __typename?: 'QueryEnvironmentsConnection';
  edges: Array<QueryEnvironmentsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryEnvironmentsConnectionEdge = {
  __typename?: 'QueryEnvironmentsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Environment;
};

export type QueryEventsConnection = {
  __typename?: 'QueryEventsConnection';
  edges: Array<QueryEventsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryEventsConnectionEdge = {
  __typename?: 'QueryEventsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Event;
};

export type QueryIntegrationAuthsConnection = {
  __typename?: 'QueryIntegrationAuthsConnection';
  edges: Array<QueryIntegrationAuthsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryIntegrationAuthsConnectionEdge = {
  __typename?: 'QueryIntegrationAuthsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: IntegrationAuth;
};

export type QueryIntegrationsConnection = {
  __typename?: 'QueryIntegrationsConnection';
  edges: Array<QueryIntegrationsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryIntegrationsConnectionEdge = {
  __typename?: 'QueryIntegrationsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Integration;
};

export type QueryNotificationDeliveriesConnection = {
  __typename?: 'QueryNotificationDeliveriesConnection';
  edges: Array<QueryNotificationDeliveriesConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryNotificationDeliveriesConnectionEdge = {
  __typename?: 'QueryNotificationDeliveriesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: NotificationDelivery;
};

export type QueryObservabilityDashboardsConnection = {
  __typename?: 'QueryObservabilityDashboardsConnection';
  edges: Array<QueryObservabilityDashboardsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryObservabilityDashboardsConnectionEdge = {
  __typename?: 'QueryObservabilityDashboardsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ObservabilityDashboard;
};

export type QueryPasskeysConnection = {
  __typename?: 'QueryPasskeysConnection';
  edges: Array<QueryPasskeysConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryPasskeysConnectionEdge = {
  __typename?: 'QueryPasskeysConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Passkey;
};

export type QueryProjectTokensConnection = {
  __typename?: 'QueryProjectTokensConnection';
  edges: Array<QueryProjectTokensConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryProjectTokensConnectionEdge = {
  __typename?: 'QueryProjectTokensConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ProjectToken;
};

export type QueryProjectsConnection = {
  __typename?: 'QueryProjectsConnection';
  edges: Array<QueryProjectsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryProjectsConnectionEdge = {
  __typename?: 'QueryProjectsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Project;
};

export type QuerySessionsConnection = {
  __typename?: 'QuerySessionsConnection';
  edges: Array<QuerySessionsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QuerySessionsConnectionEdge = {
  __typename?: 'QuerySessionsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Session;
};

export type QueryTeamTemplatesConnection = {
  __typename?: 'QueryTeamTemplatesConnection';
  edges: Array<QueryTeamTemplatesConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryTeamTemplatesConnectionEdge = {
  __typename?: 'QueryTeamTemplatesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Template;
};

export type QueryTemplatesConnection = {
  __typename?: 'QueryTemplatesConnection';
  edges: Array<QueryTemplatesConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryTemplatesConnectionEdge = {
  __typename?: 'QueryTemplatesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Template;
};

export type QueryTrustedDomainsConnection = {
  __typename?: 'QueryTrustedDomainsConnection';
  edges: Array<QueryTrustedDomainsConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryTrustedDomainsConnectionEdge = {
  __typename?: 'QueryTrustedDomainsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: TrustedDomain;
};

export type QueryUserTemplatesConnection = {
  __typename?: 'QueryUserTemplatesConnection';
  edges: Array<QueryUserTemplatesConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryUserTemplatesConnectionEdge = {
  __typename?: 'QueryUserTemplatesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Template;
};

export type QueryWorkspaceIdentityProvidersConnection = {
  __typename?: 'QueryWorkspaceIdentityProvidersConnection';
  edges: Array<QueryWorkspaceIdentityProvidersConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryWorkspaceIdentityProvidersConnectionEdge = {
  __typename?: 'QueryWorkspaceIdentityProvidersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: WorkspaceIdentityProvider;
};

export type QueryWorkspaceTemplatesConnection = {
  __typename?: 'QueryWorkspaceTemplatesConnection';
  edges: Array<QueryWorkspaceTemplatesConnectionEdge>;
  pageInfo: PageInfo;
};

export type QueryWorkspaceTemplatesConnectionEdge = {
  __typename?: 'QueryWorkspaceTemplatesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Template;
};

export type RecoveryCodeValidateInput = {
  code: Scalars['String']['input'];
  twoFactorLinkingKey?: InputMaybe<Scalars['String']['input']>;
};

export type RecoveryCodes = {
  __typename?: 'RecoveryCodes';
  recoveryCodes: Array<Scalars['String']['output']>;
};

export type ReferralInfo = Node & {
  __typename?: 'ReferralInfo';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  referralStats: ReferralStats;
  status: Scalars['String']['output'];
};

export type ReferralInfoUpdateInput = {
  code: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
};

export type ReferralStats = {
  __typename?: 'ReferralStats';
  credited: Scalars['Int']['output'];
  pending: Scalars['Int']['output'];
};

export enum ReferralStatus {
  RefereeCredited = 'REFEREE_CREDITED',
  ReferrerCredited = 'REFERRER_CREDITED',
  Registered = 'REGISTERED'
}

export type ReferralUser = {
  __typename?: 'ReferralUser';
  code: Scalars['String']['output'];
  id: Scalars['String']['output'];
  status: ReferralStatus;
};

export type Region = {
  __typename?: 'Region';
  /** Region country */
  country: Scalars['String']['output'];
  deploymentConstraints?: Maybe<RegionDeploymentConstraints>;
  location: Scalars['String']['output'];
  name: Scalars['String']['output'];
  /** Region is on Railway Metal */
  railwayMetal?: Maybe<Scalars['Boolean']['output']>;
  region?: Maybe<Scalars['String']['output']>;
  workspaceId?: Maybe<Scalars['String']['output']>;
};

export type RegionDeploymentConstraints = {
  __typename?: 'RegionDeploymentConstraints';
  /** Admin only region */
  adminOnly?: Maybe<Scalars['Boolean']['output']>;
  /** Deprecation information for the region */
  deprecationInfo?: Maybe<RegionDeprecationInfo>;
  runtimeExclusivity?: Maybe<Array<Scalars['String']['output']>>;
  /** Staging only region */
  stagingOnly?: Maybe<Scalars['Boolean']['output']>;
};

export type RegionDeprecationInfo = {
  __typename?: 'RegionDeprecationInfo';
  /** Specifies if the region is deprecated */
  isDeprecated: Scalars['Boolean']['output'];
  /** Replacement region for the deprecated region */
  replacementRegion: Scalars['String']['output'];
};

export enum RegistrationStatus {
  Onboarded = 'ONBOARDED',
  Registered = 'REGISTERED',
  Waitlisted = 'WAITLISTED'
}

/** Private Docker registry credentials. Only available for Pro plan deployments. */
export type RegistryCredentialsInput = {
  password: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export enum ReplicateVolumeInstanceSnapshotStatus {
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Initiated = 'INITIATED',
  Transferring = 'TRANSFERRING',
  Unrecognized = 'UNRECOGNIZED'
}

/** The status of a volume instance replication */
export enum ReplicateVolumeInstanceStatus {
  Completed = 'COMPLETED',
  Error = 'ERROR',
  Queued = 'QUEUED',
  TransferringOffline = 'TRANSFERRING_OFFLINE',
  TransferringOnline = 'TRANSFERRING_ONLINE'
}

export type ResetPluginCredentialsInput = {
  environmentId: Scalars['String']['input'];
};

export type ResetPluginInput = {
  environmentId: Scalars['String']['input'];
};

export type ResourceAccess = {
  __typename?: 'ResourceAccess';
  deployment: AccessRule;
  project: AccessRule;
};

export enum ResourceOwnerType {
  Workspace = 'WORKSPACE'
}

export enum RestartPolicyType {
  Always = 'ALWAYS',
  Never = 'NEVER',
  OnFailure = 'ON_FAILURE'
}

export type Service = Node & {
  __typename?: 'Service';
  createdAt: Scalars['DateTime']['output'];
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  /** @deprecated Use environment.deployments for properly scoped access control */
  deployments: ServiceDeploymentsConnection;
  featureFlags: Array<ActiveServiceFeatureFlag>;
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  project: Project;
  projectId: Scalars['String']['output'];
  repoTriggers: ServiceRepoTriggersConnection;
  /** @deprecated Use environment.serviceInstances for properly scoped access control */
  serviceInstances: ServiceServiceInstancesConnection;
  templateServiceId?: Maybe<Scalars['String']['output']>;
  templateThreadSlug?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};


export type ServiceDeploymentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ServiceRepoTriggersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type ServiceServiceInstancesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type ServiceBackupInfo = {
  __typename?: 'ServiceBackupInfo';
  /** List of enabled backup schedule kinds (DAILY, WEEKLY, MONTHLY) */
  schedules: Array<VolumeInstanceBackupScheduleKind>;
  serviceId: Scalars['String']['output'];
  serviceName: Scalars['String']['output'];
};

export type ServiceConnectInput = {
  /** The branch to connect to. e.g. 'main' */
  branch?: InputMaybe<Scalars['String']['input']>;
  /** Name of the Dockerhub or GHCR image to connect this service to. */
  image?: InputMaybe<Scalars['String']['input']>;
  /** The full name of the repo to connect to. e.g. 'railwayapp/starters' */
  repo?: InputMaybe<Scalars['String']['input']>;
};

export type ServiceCreateInput = {
  branch?: InputMaybe<Scalars['String']['input']>;
  /** Environment ID. If the specified environment is a fork, the service will only be created in it. Otherwise it will created in all environments that are not forks of other environments */
  environmentId?: InputMaybe<Scalars['String']['input']>;
  icon?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  projectId: Scalars['String']['input'];
  registryCredentials?: InputMaybe<RegistryCredentialsInput>;
  source?: InputMaybe<ServiceSourceInput>;
  templateServiceId?: InputMaybe<Scalars['String']['input']>;
  variables?: InputMaybe<Scalars['EnvironmentVariables']['input']>;
};

export type ServiceDeploymentsConnection = {
  __typename?: 'ServiceDeploymentsConnection';
  edges: Array<ServiceDeploymentsConnectionEdge>;
  pageInfo: PageInfo;
};

export type ServiceDeploymentsConnectionEdge = {
  __typename?: 'ServiceDeploymentsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Deployment;
};

export type ServiceDomain = Domain & {
  __typename?: 'ServiceDomain';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  domain: Scalars['String']['output'];
  edgeId?: Maybe<Scalars['String']['output']>;
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  projectId?: Maybe<Scalars['String']['output']>;
  serviceId: Scalars['String']['output'];
  suffix?: Maybe<Scalars['String']['output']>;
  targetPort?: Maybe<Scalars['Int']['output']>;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type ServiceDomainCreateInput = {
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  targetPort?: InputMaybe<Scalars['Int']['input']>;
};

export type ServiceDomainUpdateInput = {
  domain: Scalars['String']['input'];
  environmentId: Scalars['String']['input'];
  serviceDomainId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  targetPort?: InputMaybe<Scalars['Int']['input']>;
};

export type ServiceFeatureFlagToggleInput = {
  flag: ActiveServiceFeatureFlag;
  serviceId: Scalars['String']['input'];
};

export type ServiceInstance = Node & {
  __typename?: 'ServiceInstance';
  /** All currently active (deployed and running) deployments for this service instance */
  activeDeployments: Array<Deployment>;
  buildCommand?: Maybe<Scalars['String']['output']>;
  builder: Builder;
  createdAt: Scalars['DateTime']['output'];
  cronSchedule?: Maybe<Scalars['String']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  dockerfilePath?: Maybe<Scalars['String']['output']>;
  domains: AllDomains;
  drainingSeconds?: Maybe<Scalars['Int']['output']>;
  environmentId: Scalars['String']['output'];
  healthcheckPath?: Maybe<Scalars['String']['output']>;
  healthcheckTimeout?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  isUpdatable: Scalars['Boolean']['output'];
  /** The most recent deployment for this service instance */
  latestDeployment?: Maybe<Deployment>;
  nextCronRunAt?: Maybe<Scalars['DateTime']['output']>;
  nixpacksPlan?: Maybe<Scalars['JSON']['output']>;
  numReplicas?: Maybe<Scalars['Int']['output']>;
  overlapSeconds?: Maybe<Scalars['Int']['output']>;
  preDeployCommand?: Maybe<Scalars['JSON']['output']>;
  railpackInfo?: Maybe<Scalars['RailpackInfo']['output']>;
  railwayConfigFile?: Maybe<Scalars['String']['output']>;
  region?: Maybe<Scalars['String']['output']>;
  restartPolicyMaxRetries: Scalars['Int']['output'];
  restartPolicyType: RestartPolicyType;
  rootDirectory?: Maybe<Scalars['String']['output']>;
  service: Service;
  serviceId: Scalars['String']['output'];
  serviceName: Scalars['String']['output'];
  sleepApplication?: Maybe<Scalars['Boolean']['output']>;
  source?: Maybe<ServiceSource>;
  startCommand?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  upstreamUrl?: Maybe<Scalars['String']['output']>;
  watchPatterns: Array<Scalars['String']['output']>;
};

export type ServiceInstanceLimitsUpdateInput = {
  environmentId: Scalars['String']['input'];
  /** Amount of memory in GB to allocate to the service instance */
  memoryGB?: InputMaybe<Scalars['Float']['input']>;
  serviceId: Scalars['String']['input'];
  /** Number of vCPUs to allocate to the service instance */
  vCPUs?: InputMaybe<Scalars['Float']['input']>;
};

export type ServiceInstanceUpdateInput = {
  buildCommand?: InputMaybe<Scalars['String']['input']>;
  builder?: InputMaybe<Builder>;
  cronSchedule?: InputMaybe<Scalars['String']['input']>;
  dockerfilePath?: InputMaybe<Scalars['String']['input']>;
  drainingSeconds?: InputMaybe<Scalars['Int']['input']>;
  healthcheckPath?: InputMaybe<Scalars['String']['input']>;
  healthcheckTimeout?: InputMaybe<Scalars['Int']['input']>;
  multiRegionConfig?: InputMaybe<Scalars['JSON']['input']>;
  nixpacksPlan?: InputMaybe<Scalars['JSON']['input']>;
  numReplicas?: InputMaybe<Scalars['Int']['input']>;
  overlapSeconds?: InputMaybe<Scalars['Int']['input']>;
  preDeployCommand?: InputMaybe<Array<Scalars['String']['input']>>;
  railwayConfigFile?: InputMaybe<Scalars['String']['input']>;
  region?: InputMaybe<Scalars['String']['input']>;
  registryCredentials?: InputMaybe<RegistryCredentialsInput>;
  restartPolicyMaxRetries?: InputMaybe<Scalars['Int']['input']>;
  restartPolicyType?: InputMaybe<RestartPolicyType>;
  rootDirectory?: InputMaybe<Scalars['String']['input']>;
  sleepApplication?: InputMaybe<Scalars['Boolean']['input']>;
  source?: InputMaybe<ServiceSourceInput>;
  startCommand?: InputMaybe<Scalars['String']['input']>;
  watchPatterns?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type ServiceRepoTriggersConnection = {
  __typename?: 'ServiceRepoTriggersConnection';
  edges: Array<ServiceRepoTriggersConnectionEdge>;
  pageInfo: PageInfo;
};

export type ServiceRepoTriggersConnectionEdge = {
  __typename?: 'ServiceRepoTriggersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: DeploymentTrigger;
};

export type ServiceServiceInstancesConnection = {
  __typename?: 'ServiceServiceInstancesConnection';
  edges: Array<ServiceServiceInstancesConnectionEdge>;
  pageInfo: PageInfo;
};

export type ServiceServiceInstancesConnectionEdge = {
  __typename?: 'ServiceServiceInstancesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ServiceInstance;
};

export type ServiceSource = {
  __typename?: 'ServiceSource';
  image?: Maybe<Scalars['String']['output']>;
  repo?: Maybe<Scalars['String']['output']>;
};

export type ServiceSourceInput = {
  image?: InputMaybe<Scalars['String']['input']>;
  repo?: InputMaybe<Scalars['String']['input']>;
};

export type ServiceUpdateInput = {
  icon?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type Session = Node & {
  __typename?: 'Session';
  createdAt: Scalars['DateTime']['output'];
  expiredAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  isCurrent: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  type: SessionType;
  updatedAt: Scalars['DateTime']['output'];
};

export enum SessionType {
  Browser = 'BROWSER',
  Cli = 'CLI',
  Forums = 'FORUMS'
}

export type SharedVariableConfigureInput = {
  disabledServiceIds: Array<Scalars['String']['input']>;
  enabledServiceIds: Array<Scalars['String']['input']>;
  environmentId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
};

export type SimilarTemplate = {
  __typename?: 'SimilarTemplate';
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  creator?: Maybe<TemplateCreator>;
  deploys: Scalars['Int']['output'];
  description?: Maybe<Scalars['String']['output']>;
  health?: Maybe<Scalars['Float']['output']>;
  image?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  /** @deprecated Use workspaceId */
  teamId?: Maybe<Scalars['String']['output']>;
  userId?: Maybe<Scalars['String']['output']>;
  workspaceId?: Maybe<Scalars['String']['output']>;
};

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc'
}

export type Subscription = {
  __typename?: 'Subscription';
  /** Stream logs for a build */
  buildLogs: Array<Log>;
  /** Subscribe to updates for a specific deployment */
  deployment: Deployment;
  /** Subscribe to deployment events for a specific deployment */
  deploymentEvents: DeploymentEvent;
  /** Subscribe to deployment instance executions for a specific deployment */
  deploymentInstanceExecutions: DeploymentInstanceExecution;
  /** Stream logs for a deployment */
  deploymentLogs: Array<Log>;
  /** Stream logs for a project environment */
  environmentLogs: Array<Log>;
  /** Subscribe to updates for the staged patch for a single environment. */
  environmentStagedPatch: EnvironmentPatch;
  /** Stream HTTP logs for a deployment */
  httpLogs: Array<HttpLog>;
  /** Subscribe to notification delivery updates (created and resolved) for the authenticated user */
  notificationDeliveryUpdated: NotificationDeliveryUpdate;
  /**
   * Stream logs for a plugin
   * @deprecated Plugins are deprecated
   */
  pluginLogs: Array<Log>;
  /** Subscribe to migration progress updates for a volume */
  replicationProgress: VolumeReplicationProgressUpdate;
};


export type SubscriptionBuildLogsArgs = {
  deploymentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SubscriptionDeploymentArgs = {
  id: Scalars['String']['input'];
};


export type SubscriptionDeploymentEventsArgs = {
  id: Scalars['String']['input'];
};


export type SubscriptionDeploymentInstanceExecutionsArgs = {
  input: DeploymentInstanceExecutionInput;
};


export type SubscriptionDeploymentLogsArgs = {
  deploymentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SubscriptionEnvironmentLogsArgs = {
  afterDate?: InputMaybe<Scalars['String']['input']>;
  afterLimit?: InputMaybe<Scalars['Int']['input']>;
  anchorDate?: InputMaybe<Scalars['String']['input']>;
  beforeDate?: InputMaybe<Scalars['String']['input']>;
  beforeLimit?: InputMaybe<Scalars['Int']['input']>;
  environmentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
};


export type SubscriptionEnvironmentStagedPatchArgs = {
  environmentId: Scalars['String']['input'];
};


export type SubscriptionHttpLogsArgs = {
  afterDate?: InputMaybe<Scalars['String']['input']>;
  afterLimit?: InputMaybe<Scalars['Int']['input']>;
  anchorDate?: InputMaybe<Scalars['String']['input']>;
  beforeDate?: InputMaybe<Scalars['String']['input']>;
  beforeLimit?: InputMaybe<Scalars['Int']['input']>;
  deploymentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
};


export type SubscriptionPluginLogsArgs = {
  environmentId: Scalars['String']['input'];
  filter?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  pluginId: Scalars['String']['input'];
};


export type SubscriptionReplicationProgressArgs = {
  volumeInstanceId: Scalars['String']['input'];
};

export type SubscriptionDiscount = {
  __typename?: 'SubscriptionDiscount';
  couponId: Scalars['String']['output'];
  couponName: Scalars['String']['output'];
};

export type SubscriptionItem = {
  __typename?: 'SubscriptionItem';
  itemId: Scalars['String']['output'];
  priceDollars?: Maybe<Scalars['Float']['output']>;
  priceId: Scalars['String']['output'];
  productId: Scalars['String']['output'];
  quantity?: Maybe<Scalars['BigInt']['output']>;
};

export enum SubscriptionModel {
  Free = 'FREE',
  Team = 'TEAM',
  User = 'USER'
}

export enum SubscriptionPlanType {
  Free = 'free',
  Hobby = 'hobby',
  Pro = 'pro',
  Trial = 'trial'
}

export enum SubscriptionState {
  Active = 'ACTIVE',
  Cancelled = 'CANCELLED',
  Inactive = 'INACTIVE',
  PastDue = 'PAST_DUE',
  Unpaid = 'UNPAID'
}

export enum SupportTierOverride {
  BusinessClass = 'BUSINESS_CLASS',
  BusinessClassTrial = 'BUSINESS_CLASS_TRIAL'
}

export type TcpProxy = {
  __typename?: 'TCPProxy';
  applicationPort: Scalars['Int']['output'];
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  deletedAt?: Maybe<Scalars['DateTime']['output']>;
  domain: Scalars['String']['output'];
  environmentId: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  proxyPort: Scalars['Int']['output'];
  serviceId: Scalars['String']['output'];
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export type TcpProxyCreateInput = {
  applicationPort: Scalars['Int']['input'];
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
};

export type Team = Node & {
  __typename?: 'Team';
  /** @deprecated Use workspace object instead */
  adoptionHistory: Array<AdoptionInfo>;
  /** @deprecated Use workspace object instead */
  adoptionLevel: Scalars['Float']['output'];
  /** @deprecated Use workspace object instead */
  apiTokenRateLimit?: Maybe<ApiTokenRateLimit>;
  /** @deprecated Use workspace object instead */
  avatar?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use workspace object instead */
  createdAt: Scalars['DateTime']['output'];
  /** @deprecated Use workspace object instead */
  customer: Customer;
  /** @deprecated Use workspace object instead */
  id: Scalars['ID']['output'];
  /** @deprecated Use workspace object instead */
  members: Array<TeamMember>;
  /** @deprecated Use workspace object instead */
  name: Scalars['String']['output'];
  /** @deprecated Use workspace object instead */
  preferredRegion?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use workspace object instead */
  projects: TeamProjectsConnection;
  /** @deprecated Use workspace object instead */
  slackChannelId?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use workspace object instead */
  supportTierOverride?: Maybe<SupportTierOverride>;
  /** @deprecated Use workspace object instead */
  teamPermissions: Array<TeamPermission>;
  /** @deprecated Use workspace object instead */
  updatedAt: Scalars['DateTime']['output'];
  /** @deprecated Use workspace object instead */
  workspace: Workspace;
};


export type TeamProjectsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type TeamMember = {
  __typename?: 'TeamMember';
  avatar?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  /** Only retrieved if requested by an admin */
  featureFlags?: Maybe<Array<ActiveFeatureFlag>>;
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  role: TeamRole;
};

export type TeamPermission = Node & {
  __typename?: 'TeamPermission';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  role: TeamRole;
  updatedAt: Scalars['DateTime']['output'];
  userId: Scalars['String']['output'];
  workspaceId: Scalars['String']['output'];
};

export type TeamProjectsConnection = {
  __typename?: 'TeamProjectsConnection';
  edges: Array<TeamProjectsConnectionEdge>;
  pageInfo: PageInfo;
};

export type TeamProjectsConnectionEdge = {
  __typename?: 'TeamProjectsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Project;
};

export enum TeamRole {
  Admin = 'ADMIN',
  Member = 'MEMBER',
  Viewer = 'VIEWER'
}

export type Template = Node & {
  __typename?: 'Template';
  activeProjects: Scalars['Int']['output'];
  canvasConfig?: Maybe<Scalars['CanvasConfig']['output']>;
  category?: Maybe<Scalars['String']['output']>;
  code: Scalars['String']['output'];
  communityThreadSlug?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use serializedConfig instead */
  config: Scalars['TemplateConfig']['output'];
  createdAt: Scalars['DateTime']['output'];
  creator?: Maybe<TemplateCreator>;
  demoProjectId?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  guides?: Maybe<TemplateGuide>;
  health?: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  image?: Maybe<Scalars['String']['output']>;
  isApproved: Scalars['Boolean']['output'];
  isV2Template: Scalars['Boolean']['output'];
  isVerified: Scalars['Boolean']['output'];
  languages?: Maybe<Array<Scalars['String']['output']>>;
  /** @deprecated Deprecated in favor of listing the fields individually. */
  metadata: Scalars['TemplateMetadata']['output'];
  name: Scalars['String']['output'];
  projects: Scalars['Int']['output'];
  readme?: Maybe<Scalars['String']['output']>;
  recentProjects: Scalars['Int']['output'];
  serializedConfig?: Maybe<Scalars['SerializedTemplateConfig']['output']>;
  services: TemplateServicesConnection;
  similarTemplates: Array<SimilarTemplate>;
  status: TemplateStatus;
  supportHealthMetrics?: Maybe<Scalars['SupportHealthMetrics']['output']>;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  /** @deprecated Use workspaceId */
  teamId?: Maybe<Scalars['String']['output']>;
  totalPayout: Scalars['Float']['output'];
  workspaceId?: Maybe<Scalars['String']['output']>;
};


export type TemplateServicesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type TemplateCloneInput = {
  code: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type TemplateCreator = {
  __typename?: 'TemplateCreator';
  avatar?: Maybe<Scalars['String']['output']>;
  hasPublicProfile: Scalars['Boolean']['output'];
  name?: Maybe<Scalars['String']['output']>;
  username?: Maybe<Scalars['String']['output']>;
};

export type TemplateDeleteInput = {
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type TemplateDeployInput = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  services: Array<TemplateDeployService>;
  templateCode?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type TemplateDeployPayload = {
  __typename?: 'TemplateDeployPayload';
  projectId: Scalars['String']['output'];
  workflowId?: Maybe<Scalars['String']['output']>;
};

export type TemplateDeployService = {
  commit?: InputMaybe<Scalars['String']['input']>;
  hasDomain?: InputMaybe<Scalars['Boolean']['input']>;
  healthcheckPath?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  isPrivate?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  owner?: InputMaybe<Scalars['String']['input']>;
  preDeployCommand?: InputMaybe<Array<Scalars['String']['input']>>;
  rootDirectory?: InputMaybe<Scalars['String']['input']>;
  serviceIcon?: InputMaybe<Scalars['String']['input']>;
  serviceName: Scalars['String']['input'];
  startCommand?: InputMaybe<Scalars['String']['input']>;
  tcpProxyApplicationPort?: InputMaybe<Scalars['Int']['input']>;
  template: Scalars['String']['input'];
  variables?: InputMaybe<Scalars['EnvironmentVariables']['input']>;
  volumes?: InputMaybe<Array<Scalars['TemplateVolume']['input']>>;
};

export type TemplateDeployV2Input = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  projectId?: InputMaybe<Scalars['String']['input']>;
  serializedConfig: Scalars['SerializedTemplateConfig']['input'];
  templateId: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type TemplateGenerateInput = {
  environmentId?: InputMaybe<Scalars['String']['input']>;
  projectId: Scalars['String']['input'];
};

export type TemplateGuide = {
  __typename?: 'TemplateGuide';
  post?: Maybe<Scalars['String']['output']>;
  video?: Maybe<Scalars['String']['output']>;
};

export type TemplateMetrics = {
  __typename?: 'TemplateMetrics';
  activeDeployments: Scalars['Int']['output'];
  deploymentsLast90Days: Scalars['Int']['output'];
  earningsLast30Days: Scalars['Float']['output'];
  earningsLast90Days: Scalars['Float']['output'];
  eligibleForSupportBonus: Scalars['Boolean']['output'];
  supportHealth: Scalars['Float']['output'];
  templateHealth: Scalars['Float']['output'];
  totalDeployments: Scalars['Int']['output'];
  totalEarnings: Scalars['Float']['output'];
};

export type TemplatePublishInput = {
  category: Scalars['String']['input'];
  demoProjectId?: InputMaybe<Scalars['String']['input']>;
  description: Scalars['String']['input'];
  image?: InputMaybe<Scalars['String']['input']>;
  readme: Scalars['String']['input'];
  workspaceId?: InputMaybe<Scalars['String']['input']>;
};

export type TemplateService = Node & {
  __typename?: 'TemplateService';
  config: Scalars['TemplateServiceConfig']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  templateId: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type TemplateServiceSourceEjectInput = {
  projectId: Scalars['String']['input'];
  repoName: Scalars['String']['input'];
  repoOwner: Scalars['String']['input'];
  /** Provide multiple serviceIds when ejecting services from a monorepo. */
  serviceIds: Array<Scalars['String']['input']>;
  upstreamUrl: Scalars['String']['input'];
};

export type TemplateServicesConnection = {
  __typename?: 'TemplateServicesConnection';
  edges: Array<TemplateServicesConnectionEdge>;
  pageInfo: PageInfo;
};

export type TemplateServicesConnectionEdge = {
  __typename?: 'TemplateServicesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: TemplateService;
};

export enum TemplateStatus {
  Hidden = 'HIDDEN',
  Published = 'PUBLISHED',
  Unpublished = 'UNPUBLISHED'
}

export type TrustedDomain = {
  __typename?: 'TrustedDomain';
  domainName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  role: Scalars['String']['output'];
  verificationData: TrustedDomainVerificationData;
  verificationType: Scalars['String']['output'];
  workspaceId: Scalars['String']['output'];
};

export type TrustedDomainVerificationData = {
  __typename?: 'TrustedDomainVerificationData';
  domainMatch?: Maybe<Domain>;
  domainStatus?: Maybe<CustomDomainStatus>;
};

export type TwoFactorInfo = {
  __typename?: 'TwoFactorInfo';
  hasRecoveryCodes: Scalars['Boolean']['output'];
  isVerified: Scalars['Boolean']['output'];
};

export type TwoFactorInfoCreateInput = {
  token: Scalars['String']['input'];
};

export type TwoFactorInfoSecret = {
  __typename?: 'TwoFactorInfoSecret';
  secret: Scalars['String']['output'];
  uri: Scalars['String']['output'];
};

export type TwoFactorInfoValidateInput = {
  token: Scalars['String']['input'];
  twoFactorLinkingKey?: InputMaybe<Scalars['String']['input']>;
};

export enum TwoFactorMethodCompliance {
  Authenticator = 'AUTHENTICATOR',
  Passkey = 'PASSKEY'
}

export enum TwoFactorMethodProjectWorkspace {
  Authenticator = 'AUTHENTICATOR',
  Passkey = 'PASSKEY'
}

export type UsageLimit = Node & {
  __typename?: 'UsageLimit';
  customerId: Scalars['String']['output'];
  hardLimit?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  isOverLimit: Scalars['Boolean']['output'];
  softLimit: Scalars['Int']['output'];
};

export type UsageLimitRemoveInput = {
  customerId: Scalars['String']['input'];
};

export type UsageLimitSetInput = {
  customerId: Scalars['String']['input'];
  hardLimitDollars?: InputMaybe<Scalars['Int']['input']>;
  softLimitDollars: Scalars['Int']['input'];
};

export type User = Node & {
  __typename?: 'User';
  agreedFairUse: Scalars['Boolean']['output'];
  apiTokenRateLimit?: Maybe<ApiTokenRateLimit>;
  avatar?: Maybe<Scalars['String']['output']>;
  banReason?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  featureFlags: Array<ActiveFeatureFlag>;
  flags: Array<UserFlag>;
  githubProviderId?: Maybe<Scalars['String']['output']>;
  githubUsername?: Maybe<Scalars['String']['output']>;
  has2FA: Scalars['Boolean']['output'];
  hasPasskeys: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isAdmin: Scalars['Boolean']['output'];
  isConductor: Scalars['Boolean']['output'];
  isVerified: Scalars['Boolean']['output'];
  lastLogin: Scalars['DateTime']['output'];
  name?: Maybe<Scalars['String']['output']>;
  platformFeatureFlags: Array<ActivePlatformFlag>;
  profile?: Maybe<UserProfile>;
  /** @deprecated This field will not return anything anymore, go through the workspace's projects */
  projects: UserProjectsConnection;
  providerAuths: UserProviderAuthsConnection;
  registrationStatus: RegistrationStatus;
  riskLevel?: Maybe<Scalars['Float']['output']>;
  termsAgreedOn?: Maybe<Scalars['DateTime']['output']>;
  username?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use user.workspaces instead, no user are associated to a workspace */
  workspace?: Maybe<Workspace>;
  /** Workspaces user is member of */
  workspaces: Array<Workspace>;
};


export type UserProjectsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type UserProviderAuthsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export enum UserFlag {
  Beta = 'BETA'
}

export type UserFlagsRemoveInput = {
  flags: Array<UserFlag>;
  userId?: InputMaybe<Scalars['String']['input']>;
};

export type UserFlagsSetInput = {
  flags: Array<UserFlag>;
  userId?: InputMaybe<Scalars['String']['input']>;
};

export type UserKickbackEarnings = {
  __typename?: 'UserKickbackEarnings';
  total_amount: Scalars['Float']['output'];
};

export type UserProfile = {
  __typename?: 'UserProfile';
  bio?: Maybe<Scalars['String']['output']>;
  isPublic: Scalars['Boolean']['output'];
  website?: Maybe<Scalars['String']['output']>;
};

export type UserProfileResponse = {
  __typename?: 'UserProfileResponse';
  avatar?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  customerId?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  isTrialing?: Maybe<Scalars['Boolean']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  profile: UserProfile;
  /** Gets all public projects for a user. */
  publicProjects: UserProfileResponsePublicProjectsConnection;
  /** @deprecated There are no personal templates anymore, they all belong to a workspace */
  publishedTemplates: Array<SimilarTemplate>;
  state?: Maybe<Scalars['String']['output']>;
  totalDeploys: Scalars['Int']['output'];
  username?: Maybe<Scalars['String']['output']>;
};


export type UserProfileResponsePublicProjectsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type UserProfileResponsePublicProjectsConnection = {
  __typename?: 'UserProfileResponsePublicProjectsConnection';
  edges: Array<UserProfileResponsePublicProjectsConnectionEdge>;
  pageInfo: PageInfo;
};

export type UserProfileResponsePublicProjectsConnectionEdge = {
  __typename?: 'UserProfileResponsePublicProjectsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Project;
};

export type UserProfileUpdateInput = {
  bio?: InputMaybe<Scalars['String']['input']>;
  isPublic: Scalars['Boolean']['input'];
  website?: InputMaybe<Scalars['String']['input']>;
};

export type UserProjectsConnection = {
  __typename?: 'UserProjectsConnection';
  edges: Array<UserProjectsConnectionEdge>;
  pageInfo: PageInfo;
};

export type UserProjectsConnectionEdge = {
  __typename?: 'UserProjectsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Project;
};

export type UserProviderAuthsConnection = {
  __typename?: 'UserProviderAuthsConnection';
  edges: Array<UserProviderAuthsConnectionEdge>;
  pageInfo: PageInfo;
};

export type UserProviderAuthsConnectionEdge = {
  __typename?: 'UserProviderAuthsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ProviderAuth;
};

export type Variable = Node & {
  __typename?: 'Variable';
  createdAt: Scalars['DateTime']['output'];
  environment: Environment;
  environmentId?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isSealed: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  plugin: Plugin;
  /** @deprecated Plugins have been removed */
  pluginId?: Maybe<Scalars['String']['output']>;
  references: Array<Scalars['String']['output']>;
  service: Service;
  serviceId?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type VariableCollectionUpsertInput = {
  environmentId: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  /** When set to true, removes all existing variables before upserting the new collection. */
  replace?: InputMaybe<Scalars['Boolean']['input']>;
  serviceId?: InputMaybe<Scalars['String']['input']>;
  /** Skip deploys for affected services */
  skipDeploys?: InputMaybe<Scalars['Boolean']['input']>;
  variables: Scalars['EnvironmentVariables']['input'];
};

export type VariableDeleteInput = {
  environmentId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId?: InputMaybe<Scalars['String']['input']>;
};

export type VariableUpsertInput = {
  environmentId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  projectId: Scalars['String']['input'];
  serviceId?: InputMaybe<Scalars['String']['input']>;
  /** Skip deploys for affected services */
  skipDeploys?: InputMaybe<Scalars['Boolean']['input']>;
  value: Scalars['String']['input'];
};

export type VercelAccount = {
  __typename?: 'VercelAccount';
  id: Scalars['String']['output'];
  integrationAuthId: Scalars['String']['output'];
  isUser: Scalars['Boolean']['output'];
  name?: Maybe<Scalars['String']['output']>;
  projects: Array<VercelProject>;
  slug?: Maybe<Scalars['String']['output']>;
};

export type VercelInfo = {
  __typename?: 'VercelInfo';
  accounts: Array<VercelAccount>;
};

export type VercelProject = {
  __typename?: 'VercelProject';
  accountId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type Volume = Node & {
  __typename?: 'Volume';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  project: Project;
  projectId: Scalars['String']['output'];
  /** @deprecated Use environment.volumeInstances for properly scoped access control */
  volumeInstances: VolumeVolumeInstancesConnection;
};


export type VolumeVolumeInstancesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type VolumeCreateInput = {
  /** The environment to deploy the volume instances into. If `null`, the volume will not be deployed to any environment. `undefined` will deploy to all environments. */
  environmentId?: InputMaybe<Scalars['String']['input']>;
  /** The path in the container to mount the volume to */
  mountPath: Scalars['String']['input'];
  /** The project to create the volume in */
  projectId: Scalars['String']['input'];
  /** The region to create the volume instances in. If not provided, the default region will be used. */
  region?: InputMaybe<Scalars['String']['input']>;
  /** The service to attach the volume to. If not provided, the volume will be disconnected. */
  serviceId?: InputMaybe<Scalars['String']['input']>;
};

export type VolumeInstance = Node & {
  __typename?: 'VolumeInstance';
  createdAt: Scalars['DateTime']['output'];
  currentSizeMB: Scalars['Float']['output'];
  environment: Environment;
  environmentId: Scalars['String']['output'];
  externalId?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  mountPath: Scalars['String']['output'];
  region?: Maybe<Scalars['String']['output']>;
  service: Service;
  serviceId?: Maybe<Scalars['String']['output']>;
  sizeMB: Scalars['Int']['output'];
  state?: Maybe<VolumeState>;
  volume: Volume;
  volumeId: Scalars['String']['output'];
};

export type VolumeInstanceBackup = {
  __typename?: 'VolumeInstanceBackup';
  createdAt: Scalars['DateTime']['output'];
  creatorId?: Maybe<Scalars['String']['output']>;
  expiresAt?: Maybe<Scalars['DateTime']['output']>;
  externalId: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  referencedMB?: Maybe<Scalars['Int']['output']>;
  scheduleId?: Maybe<Scalars['String']['output']>;
  usedMB?: Maybe<Scalars['Int']['output']>;
  volumeInstanceSizeMB?: Maybe<Scalars['Int']['output']>;
};

export type VolumeInstanceBackupSchedule = Node & {
  __typename?: 'VolumeInstanceBackupSchedule';
  createdAt: Scalars['DateTime']['output'];
  cron: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  kind: VolumeInstanceBackupScheduleKind;
  name: Scalars['String']['output'];
  retentionSeconds?: Maybe<Scalars['Int']['output']>;
};

export enum VolumeInstanceBackupScheduleKind {
  Daily = 'DAILY',
  Monthly = 'MONTHLY',
  Weekly = 'WEEKLY'
}

export type VolumeInstanceReplicationProgress = {
  __typename?: 'VolumeInstanceReplicationProgress';
  bytesTransferred: Scalars['BigInt']['output'];
  percentComplete: Scalars['Float']['output'];
  timestamp: Scalars['DateTime']['output'];
  transferRateMbps?: Maybe<Scalars['Float']['output']>;
};

export type VolumeInstanceUpdateInput = {
  /** The mount path of the volume instance. If not provided, the mount path will not be updated. */
  mountPath?: InputMaybe<Scalars['String']['input']>;
  /** The service to attach the volume to. If not provided, the volume will be disconnected. */
  serviceId?: InputMaybe<Scalars['String']['input']>;
  /** The state of the volume instance. If not provided, the state will not be updated. */
  state?: InputMaybe<VolumeState>;
};

export type VolumeReplicationProgressUpdate = {
  __typename?: 'VolumeReplicationProgressUpdate';
  currentSnapshot: VolumeSnapshotReplicationProgressUpdate;
  destExternalId: Scalars['String']['output'];
  destRegion?: Maybe<Scalars['String']['output']>;
  destStackerId?: Maybe<Scalars['String']['output']>;
  error?: Maybe<Scalars['String']['output']>;
  estimatedTimeRemainingMs?: Maybe<Scalars['BigInt']['output']>;
  history: Array<VolumeInstanceReplicationProgress>;
  nbSnapshots: Scalars['Int']['output'];
  offlineBytesTransferred: Scalars['BigInt']['output'];
  offlineTotalBytes: Scalars['BigInt']['output'];
  onlineBytesTransferred: Scalars['BigInt']['output'];
  onlineTotalBytes: Scalars['BigInt']['output'];
  percentComplete: Scalars['Float']['output'];
  snapshotsSizes: Array<Scalars['BigInt']['output']>;
  srcExternalId: Scalars['String']['output'];
  srcRegion?: Maybe<Scalars['String']['output']>;
  srcStackerId?: Maybe<Scalars['String']['output']>;
  status: ReplicateVolumeInstanceStatus;
  transferRateMbps?: Maybe<Scalars['Float']['output']>;
};

export type VolumeSnapshotReplicationProgressUpdate = {
  __typename?: 'VolumeSnapshotReplicationProgressUpdate';
  bytesTransferred: Scalars['BigInt']['output'];
  compressedBytesTransferred: Scalars['BigInt']['output'];
  compressedTransferRateMbps?: Maybe<Scalars['Float']['output']>;
  elapsedMs: Scalars['Int']['output'];
  error?: Maybe<Scalars['String']['output']>;
  estimatedTimeRemainingMs?: Maybe<Scalars['BigInt']['output']>;
  index: Scalars['Int']['output'];
  percentComplete: Scalars['Float']['output'];
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  status: ReplicateVolumeInstanceSnapshotStatus;
  totalBytes: Scalars['BigInt']['output'];
  transferRateMbps?: Maybe<Scalars['Float']['output']>;
};

export enum VolumeState {
  Deleted = 'DELETED',
  Deleting = 'DELETING',
  Error = 'ERROR',
  Migrating = 'MIGRATING',
  MigrationPending = 'MIGRATION_PENDING',
  Ready = 'READY',
  Restoring = 'RESTORING',
  Updating = 'UPDATING'
}

export type VolumeUpdateInput = {
  /** The name of the volume */
  name?: InputMaybe<Scalars['String']['input']>;
};

export type VolumeVolumeInstancesConnection = {
  __typename?: 'VolumeVolumeInstancesConnection';
  edges: Array<VolumeVolumeInstancesConnectionEdge>;
  pageInfo: PageInfo;
};

export type VolumeVolumeInstancesConnectionEdge = {
  __typename?: 'VolumeVolumeInstancesConnectionEdge';
  cursor: Scalars['String']['output'];
  node: VolumeInstance;
};

export enum WithdrawalPlatformTypes {
  Bmac = 'BMAC',
  Github = 'GITHUB',
  Paypal = 'PAYPAL',
  StripeConnect = 'STRIPE_CONNECT'
}

export type WorkflowId = {
  __typename?: 'WorkflowId';
  workflowId?: Maybe<Scalars['String']['output']>;
};

export type WorkflowResult = {
  __typename?: 'WorkflowResult';
  error?: Maybe<Scalars['String']['output']>;
  status: WorkflowStatus;
};

export enum WorkflowStatus {
  Complete = 'Complete',
  Error = 'Error',
  NotFound = 'NotFound',
  Running = 'Running'
}

export type Workspace = Node & {
  __typename?: 'Workspace';
  adoptionHistory: Array<AdoptionInfo>;
  adoptionLevel: Scalars['Float']['output'];
  allowDeprecatedRegions?: Maybe<Scalars['Boolean']['output']>;
  apiTokenRateLimit?: Maybe<ApiTokenRateLimit>;
  avatar?: Maybe<Scalars['String']['output']>;
  banReason?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  customer: Customer;
  discordRole?: Maybe<Scalars['String']['output']>;
  /** Whether 2FA enforcement is enabled for this workspace. */
  has2FAEnforcement: Scalars['Boolean']['output'];
  hasSAML: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  identityProviders: WorkspaceIdentityProvidersConnection;
  members: Array<WorkspaceMember>;
  name: Scalars['String']['output'];
  partnerProfile?: Maybe<PartnerProfile>;
  plan: Plan;
  preferredRegion?: Maybe<Scalars['String']['output']>;
  projects: WorkspaceProjectsConnection;
  /** Whether the current user's access is redacted due to pending 2FA requirement. Returns true if the user is a workspace member, workspace has 2FA enforcement enabled, and the current user needs to enable 2FA. */
  redactedDueTo2FAPending: Scalars['Boolean']['output'];
  referredUsers: Array<ReferralUser>;
  slackChannelId?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use plan field instead */
  subscriptionModel: SubscriptionModel;
  supportTierOverride?: Maybe<SupportTierOverride>;
  /** @deprecated Teams are being removed from the system, don't use it */
  team?: Maybe<Team>;
  updatedAt: Scalars['DateTime']['output'];
  /** Get a list of user emails in the workspace who do not have verified 2FA enabled. Returns an empty array if all users have 2FA enabled. */
  usersWithout2FA: Array<Scalars['String']['output']>;
};


export type WorkspaceIdentityProvidersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type WorkspaceProjectsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type WorkspaceIdPConnection = {
  __typename?: 'WorkspaceIdPConnection';
  createdAt?: Maybe<Scalars['DateTime']['output']>;
  provider?: Maybe<Scalars['String']['output']>;
  status: WorkspaceIdPConnectionStatus;
  updatedAt?: Maybe<Scalars['DateTime']['output']>;
};

export enum WorkspaceIdPConnectionStatus {
  Active = 'ACTIVE',
  Draft = 'DRAFT',
  Inactive = 'INACTIVE',
  Pending = 'PENDING',
  Validating = 'VALIDATING'
}

export type WorkspaceIdentityProvider = Node & {
  __typename?: 'WorkspaceIdentityProvider';
  connection: WorkspaceIdPConnection;
  createdAt: Scalars['DateTime']['output'];
  enforcementEnabledAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
  workspace: Workspace;
  workspaceId: Scalars['String']['output'];
};

export type WorkspaceIdentityProvidersConnection = {
  __typename?: 'WorkspaceIdentityProvidersConnection';
  edges: Array<WorkspaceIdentityProvidersConnectionEdge>;
  pageInfo: PageInfo;
};

export type WorkspaceIdentityProvidersConnectionEdge = {
  __typename?: 'WorkspaceIdentityProvidersConnectionEdge';
  cursor: Scalars['String']['output'];
  node: WorkspaceIdentityProvider;
};

export type WorkspaceInviteCodeCreateInput = {
  role: Scalars['String']['input'];
};

export type WorkspaceMember = {
  __typename?: 'WorkspaceMember';
  avatar?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  /** Only retrieved if requested by an admin */
  featureFlags?: Maybe<Array<ActiveFeatureFlag>>;
  id: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  role: TeamRole;
  /** Only retrieved if requested by an admin */
  twoFactorAuthEnabled?: Maybe<Scalars['Boolean']['output']>;
};

export type WorkspacePermissionChangeInput = {
  role: TeamRole;
  userId: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
};

export type WorkspaceProjectsConnection = {
  __typename?: 'WorkspaceProjectsConnection';
  edges: Array<WorkspaceProjectsConnectionEdge>;
  pageInfo: PageInfo;
};

export type WorkspaceProjectsConnectionEdge = {
  __typename?: 'WorkspaceProjectsConnectionEdge';
  cursor: Scalars['String']['output'];
  node: Project;
};

export type WorkspaceTrustedDomainCreateInput = {
  domainName: Scalars['String']['input'];
  role: Scalars['String']['input'];
  workspaceId: Scalars['String']['input'];
};

export type WorkspaceUpdateInput = {
  avatar?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  preferredRegion?: InputMaybe<Scalars['String']['input']>;
};

export type WorkspaceUserInviteInput = {
  code: Scalars['String']['input'];
  email: Scalars['String']['input'];
};

export type WorkspaceUserRemoveInput = {
  userId: Scalars['String']['input'];
};

export type CustomerTogglePayoutsToCreditsInput = {
  isWithdrawingToCredits: Scalars['Boolean']['input'];
};

export type ServiceQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type ServiceQuery = { __typename?: 'Query', service: { __typename?: 'Service', id: string, name: string, icon?: string | null, createdAt: any, updatedAt: any } };

export type GetPrivateNetworkEndpointQueryVariables = Exact<{
  environmentId: Scalars['String']['input'];
  privateNetworkId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
}>;


export type GetPrivateNetworkEndpointQuery = { __typename?: 'Query', privateNetworkEndpoint?: { __typename?: 'PrivateNetworkEndpoint', dnsName: string } | null };

export type GetProjectPrivateNetworkIdQueryVariables = Exact<{
  environmentId: Scalars['String']['input'];
}>;


export type GetProjectPrivateNetworkIdQuery = { __typename?: 'Query', privateNetworks: Array<{ __typename?: 'PrivateNetwork', publicId: string }> };

export type ServiceCreateMutationVariables = Exact<{
  input: ServiceCreateInput;
}>;


export type ServiceCreateMutation = { __typename?: 'Mutation', serviceCreate: { __typename?: 'Service', id: string, name: string, icon?: string | null, createdAt: any, updatedAt: any, project: { __typename?: 'Project', baseEnvironmentId?: string | null, environments: { __typename?: 'ProjectEnvironmentsConnection', edges: Array<{ __typename?: 'ProjectEnvironmentsConnectionEdge', node: { __typename?: 'Environment', deployments: { __typename?: 'EnvironmentDeploymentsConnection', edges: Array<{ __typename?: 'EnvironmentDeploymentsConnectionEdge', node: { __typename?: 'Deployment', id: string, status: DeploymentStatus } }> } } }> } } } };

export type ServiceDeleteMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type ServiceDeleteMutation = { __typename?: 'Mutation', serviceDelete: boolean };

export type DeploymentRedeployMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeploymentRedeployMutation = { __typename?: 'Mutation', deploymentRedeploy: { __typename?: 'Deployment', id: string, status: DeploymentStatus, createdAt: any } };

export type DeploymentRemoveMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeploymentRemoveMutation = { __typename?: 'Mutation', deploymentRemove: boolean };

export type ServiceInstanceUpdateMutationVariables = Exact<{
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  image: Scalars['String']['input'];
  multiRegionConfig: Scalars['JSON']['input'];
}>;


export type ServiceInstanceUpdateMutation = { __typename?: 'Mutation', serviceInstanceUpdate: boolean };

export type ServiceInstanceDeployMutationVariables = Exact<{
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  latestCommit: Scalars['Boolean']['input'];
}>;


export type ServiceInstanceDeployMutation = { __typename?: 'Mutation', serviceInstanceDeploy: boolean };

export type VolumeCreateMutationVariables = Exact<{
  projectId: Scalars['String']['input'];
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  mountPath: Scalars['String']['input'];
  region: Scalars['String']['input'];
}>;


export type VolumeCreateMutation = { __typename?: 'Mutation', volumeCreate: { __typename?: 'Volume', id: string, name: string, createdAt: any } };

export type VolumeDeleteMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type VolumeDeleteMutation = { __typename?: 'Mutation', volumeDelete: boolean };

export type ServiceDomainCreateMutationVariables = Exact<{
  environmentId: Scalars['String']['input'];
  serviceId: Scalars['String']['input'];
  targetPort: Scalars['Int']['input'];
}>;


export type ServiceDomainCreateMutation = { __typename?: 'Mutation', serviceDomainCreate: { __typename?: 'ServiceDomain', id: string, domain: string } };

export type ServiceDomainDeleteMutationVariables = Exact<{
  serviceDomainId: Scalars['String']['input'];
}>;


export type ServiceDomainDeleteMutation = { __typename?: 'Mutation', serviceDomainDelete: boolean };


export const ServiceDocument = `
    query Service($id: String!) {
  service(id: $id) {
    id
    name
    icon
    createdAt
    updatedAt
  }
}
    `;
export const GetPrivateNetworkEndpointDocument = `
    query GetPrivateNetworkEndpoint($environmentId: String!, $privateNetworkId: String!, $serviceId: String!) {
  privateNetworkEndpoint(
    environmentId: $environmentId
    privateNetworkId: $privateNetworkId
    serviceId: $serviceId
  ) {
    dnsName
  }
}
    `;
export const GetProjectPrivateNetworkIdDocument = `
    query GetProjectPrivateNetworkId($environmentId: String!) {
  privateNetworks(environmentId: $environmentId) {
    publicId
  }
}
    `;
export const ServiceCreateDocument = `
    mutation ServiceCreate($input: ServiceCreateInput!) {
  serviceCreate(input: $input) {
    id
    name
    icon
    createdAt
    updatedAt
    project {
      baseEnvironmentId
      environments {
        edges {
          node {
            deployments(first: 1) {
              edges {
                node {
                  id
                  status
                }
              }
            }
          }
        }
      }
    }
  }
}
    `;
export const ServiceDeleteDocument = `
    mutation ServiceDelete($id: String!) {
  serviceDelete(id: $id)
}
    `;
export const DeploymentRedeployDocument = `
    mutation DeploymentRedeploy($id: String!) {
  deploymentRedeploy(id: $id) {
    id
    status
    createdAt
  }
}
    `;
export const DeploymentRemoveDocument = `
    mutation DeploymentRemove($id: String!) {
  deploymentRemove(id: $id)
}
    `;
export const ServiceInstanceUpdateDocument = `
    mutation serviceInstanceUpdate($environmentId: String!, $serviceId: String!, $image: String!, $multiRegionConfig: JSON!) {
  serviceInstanceUpdate(
    environmentId: $environmentId
    serviceId: $serviceId
    input: {source: {image: $image}, multiRegionConfig: $multiRegionConfig}
  )
}
    `;
export const ServiceInstanceDeployDocument = `
    mutation serviceInstanceDeploy($environmentId: String!, $serviceId: String!, $latestCommit: Boolean!) {
  serviceInstanceDeploy(
    environmentId: $environmentId
    serviceId: $serviceId
    latestCommit: $latestCommit
  )
}
    `;
export const VolumeCreateDocument = `
    mutation VolumeCreate($projectId: String!, $environmentId: String!, $serviceId: String!, $mountPath: String!, $region: String!) {
  volumeCreate(
    input: {projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, mountPath: $mountPath, region: $region}
  ) {
    id
    name
    createdAt
  }
}
    `;
export const VolumeDeleteDocument = `
    mutation VolumeDelete($id: String!) {
  volumeDelete(volumeId: $id)
}
    `;
export const ServiceDomainCreateDocument = `
    mutation ServiceDomainCreate($environmentId: String!, $serviceId: String!, $targetPort: Int!) {
  serviceDomainCreate(
    input: {environmentId: $environmentId, targetPort: $targetPort, serviceId: $serviceId}
  ) {
    id
    domain
  }
}
    `;
export const ServiceDomainDeleteDocument = `
    mutation ServiceDomainDelete($serviceDomainId: String!) {
  serviceDomainDelete(id: $serviceDomainId)
}
    `;
export type Requester<C = {}> = <R, V>(doc: string, vars?: V, options?: C) => Promise<R> | AsyncIterable<R>
export function getSdk<C>(requester: Requester<C>) {
  return {
    Service(variables: ServiceQueryVariables, options?: C): Promise<ServiceQuery> {
      return requester<ServiceQuery, ServiceQueryVariables>(ServiceDocument, variables, options) as Promise<ServiceQuery>;
    },
    GetPrivateNetworkEndpoint(variables: GetPrivateNetworkEndpointQueryVariables, options?: C): Promise<GetPrivateNetworkEndpointQuery> {
      return requester<GetPrivateNetworkEndpointQuery, GetPrivateNetworkEndpointQueryVariables>(GetPrivateNetworkEndpointDocument, variables, options) as Promise<GetPrivateNetworkEndpointQuery>;
    },
    GetProjectPrivateNetworkId(variables: GetProjectPrivateNetworkIdQueryVariables, options?: C): Promise<GetProjectPrivateNetworkIdQuery> {
      return requester<GetProjectPrivateNetworkIdQuery, GetProjectPrivateNetworkIdQueryVariables>(GetProjectPrivateNetworkIdDocument, variables, options) as Promise<GetProjectPrivateNetworkIdQuery>;
    },
    ServiceCreate(variables: ServiceCreateMutationVariables, options?: C): Promise<ServiceCreateMutation> {
      return requester<ServiceCreateMutation, ServiceCreateMutationVariables>(ServiceCreateDocument, variables, options) as Promise<ServiceCreateMutation>;
    },
    ServiceDelete(variables: ServiceDeleteMutationVariables, options?: C): Promise<ServiceDeleteMutation> {
      return requester<ServiceDeleteMutation, ServiceDeleteMutationVariables>(ServiceDeleteDocument, variables, options) as Promise<ServiceDeleteMutation>;
    },
    DeploymentRedeploy(variables: DeploymentRedeployMutationVariables, options?: C): Promise<DeploymentRedeployMutation> {
      return requester<DeploymentRedeployMutation, DeploymentRedeployMutationVariables>(DeploymentRedeployDocument, variables, options) as Promise<DeploymentRedeployMutation>;
    },
    DeploymentRemove(variables: DeploymentRemoveMutationVariables, options?: C): Promise<DeploymentRemoveMutation> {
      return requester<DeploymentRemoveMutation, DeploymentRemoveMutationVariables>(DeploymentRemoveDocument, variables, options) as Promise<DeploymentRemoveMutation>;
    },
    serviceInstanceUpdate(variables: ServiceInstanceUpdateMutationVariables, options?: C): Promise<ServiceInstanceUpdateMutation> {
      return requester<ServiceInstanceUpdateMutation, ServiceInstanceUpdateMutationVariables>(ServiceInstanceUpdateDocument, variables, options) as Promise<ServiceInstanceUpdateMutation>;
    },
    serviceInstanceDeploy(variables: ServiceInstanceDeployMutationVariables, options?: C): Promise<ServiceInstanceDeployMutation> {
      return requester<ServiceInstanceDeployMutation, ServiceInstanceDeployMutationVariables>(ServiceInstanceDeployDocument, variables, options) as Promise<ServiceInstanceDeployMutation>;
    },
    VolumeCreate(variables: VolumeCreateMutationVariables, options?: C): Promise<VolumeCreateMutation> {
      return requester<VolumeCreateMutation, VolumeCreateMutationVariables>(VolumeCreateDocument, variables, options) as Promise<VolumeCreateMutation>;
    },
    VolumeDelete(variables: VolumeDeleteMutationVariables, options?: C): Promise<VolumeDeleteMutation> {
      return requester<VolumeDeleteMutation, VolumeDeleteMutationVariables>(VolumeDeleteDocument, variables, options) as Promise<VolumeDeleteMutation>;
    },
    ServiceDomainCreate(variables: ServiceDomainCreateMutationVariables, options?: C): Promise<ServiceDomainCreateMutation> {
      return requester<ServiceDomainCreateMutation, ServiceDomainCreateMutationVariables>(ServiceDomainCreateDocument, variables, options) as Promise<ServiceDomainCreateMutation>;
    },
    ServiceDomainDelete(variables: ServiceDomainDeleteMutationVariables, options?: C): Promise<ServiceDomainDeleteMutation> {
      return requester<ServiceDomainDeleteMutation, ServiceDomainDeleteMutationVariables>(ServiceDomainDeleteDocument, variables, options) as Promise<ServiceDomainDeleteMutation>;
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;