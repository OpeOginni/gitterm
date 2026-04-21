import { z } from "zod";

export const providerCategoryEnum = z.enum(["compute", "sandbox", "both"]);
export const fieldTypeEnum = z.enum(["text", "password", "number", "select", "url", "boolean"]);
export const DEFAULT_RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

export interface ProviderConfigField {
  fieldName: string;
  fieldLabel: string;
  fieldType: z.infer<typeof fieldTypeEnum>;
  isRequired: boolean;
  isEncrypted: boolean;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  validationRules?: {
    min?: number;
    max?: number;
    regex?: string;
  };
  sortOrder: number;
}

export interface ProviderDefinition {
  name: string;
  displayName: string;
  category: z.infer<typeof providerCategoryEnum>;
  configSchema: z.ZodSchema;
  fields: ProviderConfigField[];
}

export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  railway: {
    name: "railway",
    displayName: "Railway",
    category: "compute",
    configSchema: z.object({
      apiUrl: z.url("Must be a valid URL").default(DEFAULT_RAILWAY_API_URL),
      apiToken: z.string().min(1, "API token is required"),
      projectId: z.string().min(1, "Project ID is required"),
      environmentId: z.string().min(1, "Environment ID is required"),
      defaultRegion: z.string().optional(),
      publicRailwayDomains: z.boolean().optional(),
    }),
    fields: [
      {
        fieldName: "apiUrl",
        fieldLabel: "API URL",
        fieldType: "url",
        isRequired: false,
        isEncrypted: false,
        defaultValue: DEFAULT_RAILWAY_API_URL,
        sortOrder: 1,
      },
      {
        fieldName: "apiToken",
        fieldLabel: "API Token",
        fieldType: "password",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 2,
      },
      {
        fieldName: "projectId",
        fieldLabel: "Project ID",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 3,
      },
      {
        fieldName: "environmentId",
        fieldLabel: "Environment ID",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 4,
      },
      {
        fieldName: "defaultRegion",
        fieldLabel: "Default Region",
        fieldType: "select",
        isRequired: false,
        isEncrypted: false,
        defaultValue: "us-east4-eqdc4a",
        options: [
          { value: "us-east4-eqdc4a", label: "US East Metal (Virginia)" },
          { value: "us-west2", label: "US West Metal (California)" },
          { value: "europe-west4-drams3a", label: "EU West Metal (Amsterdam)" },
          { value: "asia-southeast1-eqsg3a", label: "Southeast Asia Metal (Singapore)" },
        ],
        sortOrder: 5,
      },
      {
        fieldName: "publicRailwayDomains",
        fieldLabel: "Public Railway Domains",
        fieldType: "boolean",
        isRequired: false,
        isEncrypted: false,
        sortOrder: 6,
      },
    ],
  },

  aws: {
    name: "aws",
    displayName: "AWS",
    category: "compute",
    configSchema: z.object({
      accessKeyId: z.string().min(1, "Access key ID is required"),
      secretAccessKey: z.string().min(1, "Secret access key is required"),
      defaultRegion: z.string().min(1, "Default region is required"),
      clusterArn: z.string().min(1, "ECS cluster ARN is required"),
      vpcId: z.string().min(1, "VPC ID is required"),
      subnetIds: z.string().min(1, "At least one subnet ID is required"),
      securityGroupIds: z.string().min(1, "At least one security group ID is required"),
      albListenerArn: z.string().min(1, "ALB listener ARN is required"),
      albBaseUrl: z.url("Must be a valid URL"),
      taskExecutionRoleArn: z.string().min(1, "Task execution role ARN is required"),
      taskRoleArn: z.string().min(1, "Task role ARN is required"),
      assignPublicIp: z.boolean().optional(),
      efsFileSystemId: z.string().optional(),
      logGroupName: z.string().optional(),
    }),
    fields: [
      {
        fieldName: "accessKeyId",
        fieldLabel: "Access Key ID",
        fieldType: "text",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 1,
      },
      {
        fieldName: "secretAccessKey",
        fieldLabel: "Secret Access Key",
        fieldType: "password",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 2,
      },
      {
        fieldName: "defaultRegion",
        fieldLabel: "Default Region",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        defaultValue: "us-east-1",
        sortOrder: 3,
      },
      {
        fieldName: "clusterArn",
        fieldLabel: "ECS Cluster ARN",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 4,
      },
      {
        fieldName: "vpcId",
        fieldLabel: "VPC ID",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 5,
      },
      {
        fieldName: "subnetIds",
        fieldLabel: "Subnet IDs",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 6,
      },
      {
        fieldName: "securityGroupIds",
        fieldLabel: "Security Group IDs",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 7,
      },
      {
        fieldName: "albListenerArn",
        fieldLabel: "ALB Listener ARN",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 8,
      },
      {
        fieldName: "albBaseUrl",
        fieldLabel: "ALB Base URL",
        fieldType: "url",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 9,
      },
      {
        fieldName: "taskExecutionRoleArn",
        fieldLabel: "Task Execution Role ARN",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 10,
      },
      {
        fieldName: "taskRoleArn",
        fieldLabel: "Task Role ARN",
        fieldType: "text",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 11,
      },
      {
        fieldName: "assignPublicIp",
        fieldLabel: "Assign Public IP",
        fieldType: "boolean",
        isRequired: false,
        isEncrypted: false,
        sortOrder: 12,
      },
      {
        fieldName: "efsFileSystemId",
        fieldLabel: "EFS File System ID",
        fieldType: "text",
        isRequired: false,
        isEncrypted: false,
        sortOrder: 13,
      },
      {
        fieldName: "logGroupName",
        fieldLabel: "CloudWatch Log Group",
        fieldType: "text",
        isRequired: false,
        isEncrypted: false,
        sortOrder: 14,
      },
    ],
  },

  cloudflare: {
    name: "cloudflare",
    displayName: "Cloudflare Sandbox",
    category: "sandbox",
    configSchema: z.object({
      workerUrl: z.url("Must be a valid URL"),
      callbackSecret: z.string().min(1, "Callback secret is required"),
    }),
    fields: [
      {
        fieldName: "workerUrl",
        fieldLabel: "Worker URL",
        fieldType: "url",
        isRequired: true,
        isEncrypted: false,
        sortOrder: 1,
      },
      {
        fieldName: "callbackSecret",
        fieldLabel: "Callback Secret",
        fieldType: "password",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 2,
      },
    ],
  },
  e2b: {
    name: "e2b",
    displayName: "E2B",
    category: "sandbox",
    configSchema: z.object({
      apiKey: z.string().min(1, "API KEY is required"),
      webhookSecret: z.string().min(1, "Webhook secret is required"),
    }),
    fields: [
      {
        fieldName: "apiKey",
        fieldLabel: "API Key",
        fieldType: "password",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 1,
      },
      {
        fieldName: "webhookSecret",
        fieldLabel: "Webhook Secret",
        fieldType: "password",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 2,
      },
    ],
  },
  daytona: {
    name: "daytona",
    displayName: "Daytona",
    category: "sandbox",
    configSchema: z.object({
      apiKey: z.string().min(1, "API KEY is required"),
      defaultTargetRegion: z.enum(["us", "eu"], "region of eu or us is required"),
    }),
    fields: [
      {
        fieldName: "apiKey",
        fieldLabel: "API Key",
        fieldType: "password",
        isRequired: true,
        isEncrypted: true,
        sortOrder: 1,
      },
      {
        fieldName: "defaultTargetRegion",
        fieldLabel: "Default Target Region",
        fieldType: "select",
        options: [
          { value: "us", label: "United States" },
          { value: "eu", label: "Europe" },
        ],
        isRequired: true,
        isEncrypted: false,
        sortOrder: 2,
      },
    ],
  },
};

export function getProviderDefinition(providerName: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS[providerName];
}

export function getAllProviderDefinitions(): ProviderDefinition[] {
  return Object.values(PROVIDER_DEFINITIONS);
}

export function validateProviderConfig(
  providerName: string,
  config: Record<string, any>,
): { success: boolean; data?: any; errors?: string[] } {
  const definition = getProviderDefinition(providerName);
  if (!definition) {
    return { success: false, errors: [`Unknown provider: ${providerName}`] };
  }

  const result = definition.configSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    return { success: false, errors };
  }

  return { success: true, data: result.data };
}
