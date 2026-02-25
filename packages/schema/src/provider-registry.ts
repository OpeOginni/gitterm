import { z } from "zod";

export const providerCategoryEnum = z.enum(["compute", "sandbox", "both"]);
export const fieldTypeEnum = z.enum(["text", "password", "number", "select", "url", "boolean"]);

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
      apiUrl: z.url("Must be a valid URL"),
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
        isRequired: true,
        isEncrypted: false,
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
      region: z.string().min(1, "Region is required"),
      accountId: z.string().optional(),
      publicIngress: z.boolean().optional(),
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
        fieldName: "region",
        fieldLabel: "Default Region",
        fieldType: "select",
        isRequired: true,
        isEncrypted: false,
        defaultValue: "us-east-1",
        options: [
          { value: "us-east-1", label: "US East (N. Virginia)" },
          { value: "us-west-2", label: "US West (Oregon)" },
          { value: "eu-west-1", label: "EU (Ireland)" },
          { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
        ],
        sortOrder: 3,
      },
      {
        fieldName: "accountId",
        fieldLabel: "AWS Account ID",
        fieldType: "text",
        isRequired: false,
        isEncrypted: false,
        validationRules: {
          min: 12,
          max: 12,
          regex: "^\\d{12}$",
        },
        sortOrder: 4,
      },
      {
        fieldName: "publicIngress",
        fieldLabel: "Public Ingress",
        fieldType: "boolean",
        isRequired: false,
        isEncrypted: false,
        defaultValue: "false",
        sortOrder: 5,
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
};

export function getProviderDefinition(providerName: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS[providerName];
}

export function getAllProviderDefinitions(): ProviderDefinition[] {
  return Object.values(PROVIDER_DEFINITIONS);
}

export function validateProviderConfig(
  providerName: string,
  config: Record<string, any>
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
