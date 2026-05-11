import { db, eq, and } from "@gitterm/db";
import { getEncryptionService } from "../encryption";
import { providerType, providerConfig } from "@gitterm/db/schema/provider-config";
import { cloudProvider } from "@gitterm/db/schema/cloud";

import {
  getProviderDefinition,
  validateProviderConfig,
  type ProviderConfigField,
} from "@gitterm/schema";

export interface ProviderConfigInput {
  providerTypeId: string;
  name: string;
  config: Record<string, any>;
  isDefault?: boolean;
  priority?: number;
}

export interface DecryptedProviderConfig {
  id: string;
  providerTypeId: string;
  name: string;
  providerType: {
    id: string;
    name: string;
    displayName: string;
    category: string;
  };
  config: Record<string, any>;
  configPreviews?: Record<string, string>;
  isDefault: boolean;
  isEnabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

class ProviderConfigService {
  private encryption = getEncryptionService();

  async getAllProviderConfigs(includeDisabled = false): Promise<DecryptedProviderConfig[]> {
    const configs = await db.query.providerConfig.findMany({
      where: includeDisabled ? undefined : eq(providerConfig.isEnabled, true),
      with: {
        providerType: true,
      },
      orderBy: (config, { desc }) => [desc(config.priority), desc(config.createdAt)],
    });

    return configs.map((config) => this.decryptConfig(config));
  }

  async getAllProviderConfigsForDisplay(
    includeDisabled = false,
  ): Promise<DecryptedProviderConfig[]> {
    const configs = await this.getAllProviderConfigs(includeDisabled);
    return configs.map((config) => this.redactConfigForDisplay(config));
  }

  async getProviderConfigById(id: string): Promise<DecryptedProviderConfig | null> {
    const config = await db.query.providerConfig.findFirst({
      where: eq(providerConfig.id, id),
      with: {
        providerType: true,
      },
    });

    if (!config) return null;
    return this.decryptConfig(config);
  }

  async getProviderConfigByIdForDisplay(id: string): Promise<DecryptedProviderConfig | null> {
    const config = await this.getProviderConfigById(id);
    if (!config) return null;
    return this.redactConfigForDisplay(config);
  }

  async getProviderConfigByName(providerName: string): Promise<DecryptedProviderConfig | null> {
    const fetchedProviderType = await db.query.providerType.findFirst({
      where: eq(providerType.name, providerName),
    });

    if (!fetchedProviderType) return null;

    const config = await db.query.providerConfig.findFirst({
      where: and(
        eq(providerConfig.providerTypeId, fetchedProviderType.id),
        eq(providerConfig.isDefault, true),
      ),
      with: {
        providerType: true,
      },
    });

    if (!config) return null;
    return this.decryptConfig(config);
  }

  async createProviderConfig(input: ProviderConfigInput): Promise<DecryptedProviderConfig> {
    const fetchedProviderType = await db.query.providerType.findFirst({
      where: eq(providerType.id, input.providerTypeId),
    });

    if (!fetchedProviderType) {
      throw new Error(`Provider type not found: ${input.providerTypeId}`);
    }

    const definition = getProviderDefinition(fetchedProviderType.name);
    if (!definition) {
      throw new Error(`No definition found for provider type: ${fetchedProviderType.name}`);
    }

    const validation = validateProviderConfig(fetchedProviderType.name, input.config);
    if (!validation.success) {
      throw new Error(`Invalid config: ${validation.errors?.join(", ")}`);
    }

    const { encrypted, metadata } = this.separateConfigFields(
      fetchedProviderType.name,
      input.config,
    );

    const encryptedCredentials = this.encryption.encrypt(JSON.stringify(encrypted));

    const [newConfig] = await db
      .insert(providerConfig)
      .values({
        providerTypeId: input.providerTypeId,
        name: input.name,
        encryptedCredentials,
        configMetadata: metadata,
        isDefault: input.isDefault ?? false,
        isEnabled: true,
        priority: input.priority ?? 0,
      })
      .returning();

    if (!newConfig) {
      throw new Error("Issue with creating new config");
    }

    const created = await db.query.providerConfig.findFirst({
      where: eq(providerConfig.id, newConfig.id),
      with: {
        providerType: true,
      },
    });

    if (!created) throw new Error("Failed to create provider config");

    return this.decryptConfig(created);
  }

  async updateProviderConfig(
    id: string,
    updates: Partial<Omit<ProviderConfigInput, "providerTypeId">>,
  ): Promise<DecryptedProviderConfig> {
    const existing = await db.query.providerConfig.findFirst({
      where: eq(providerConfig.id, id),
      with: {
        providerType: true,
      },
    });

    if (!existing) {
      throw new Error(`Provider config not found: ${id}`);
    }

    let encryptedCredentials = existing.encryptedCredentials;
    let configMetadata = existing.configMetadata;

    if (updates.config) {
      const existingDecryptedConfig = this.decryptConfig(existing).config;
      const mergedConfig = this.mergeConfigPreservingEncryptedFields(
        existing.providerType.name,
        existingDecryptedConfig,
        updates.config,
      );

      const validation = validateProviderConfig(existing.providerType.name, mergedConfig);
      if (!validation.success) {
        throw new Error(`Invalid config: ${validation.errors?.join(", ")}`);
      }

      const { encrypted, metadata } = this.separateConfigFields(
        existing.providerType.name,
        mergedConfig,
      );
      encryptedCredentials = this.encryption.encrypt(JSON.stringify(encrypted));
      configMetadata = metadata;
    }

    const [updated] = await db
      .update(providerConfig)
      .set({
        ...(updates.name && { name: updates.name }),
        ...(updates.config && { encryptedCredentials, configMetadata }),
        ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
        ...(updates.priority !== undefined && { priority: updates.priority }),
        updatedAt: new Date(),
      })
      .where(eq(providerConfig.id, id))
      .returning();

    if (!updated) {
      throw new Error("Issue with updating config");
    }

    const config = await db.query.providerConfig.findFirst({
      where: eq(providerConfig.id, updated.id),
      with: {
        providerType: true,
      },
    });

    if (!config) throw new Error("Failed to update provider config");

    return this.decryptConfig(config);
  }

  async deleteProviderConfig(id: string): Promise<void> {
    await db.delete(providerConfig).where(eq(providerConfig.id, id));
  }

  async toggleProviderConfig(id: string, isEnabled: boolean): Promise<DecryptedProviderConfig> {
    const [updated] = await db
      .update(providerConfig)
      .set({ isEnabled, updatedAt: new Date() })
      .where(eq(providerConfig.id, id))
      .returning();

    if (!updated) {
      throw new Error("Issue with toggling config");
    }

    const config = await db.query.providerConfig.findFirst({
      where: eq(providerConfig.id, updated.id),
      with: {
        providerType: true,
      },
    });

    if (!config) throw new Error("Failed to toggle provider config");

    return this.decryptConfig(config);
  }

  private separateConfigFields(
    providerName: string,
    config: Record<string, any>,
  ): {
    encrypted: Record<string, any>;
    metadata: Record<string, any>;
  } {
    const definition = getProviderDefinition(providerName);
    if (!definition) {
      return { encrypted: config, metadata: {} };
    }

    const encrypted: Record<string, any> = {};
    const metadata: Record<string, any> = {};

    for (const field of definition.fields) {
      const value = config[field.fieldName];
      if (value !== undefined) {
        if (field.isEncrypted) {
          encrypted[field.fieldName] = value;
        } else {
          metadata[field.fieldName] = value;
        }
      }
    }

    return { encrypted, metadata };
  }

  private mergeConfigPreservingEncryptedFields(
    providerName: string,
    existingConfig: Record<string, any>,
    incomingConfig: Record<string, any>,
  ): Record<string, any> {
    const definition = getProviderDefinition(providerName);
    if (!definition) {
      return {
        ...existingConfig,
        ...incomingConfig,
      };
    }

    const mergedConfig = {
      ...existingConfig,
      ...incomingConfig,
    };

    for (const field of definition.fields) {
      if (!field.isEncrypted) {
        continue;
      }

      const incomingValue = incomingConfig[field.fieldName];
      if (
        incomingValue === undefined ||
        (typeof incomingValue === "string" && incomingValue.trim() === "")
      ) {
        mergedConfig[field.fieldName] = existingConfig[field.fieldName];
      }
    }

    return mergedConfig;
  }

  private applyConfigDefaults(
    providerName: string,
    config: Record<string, any>,
  ): Record<string, any> {
    const definition = getProviderDefinition(providerName);
    if (!definition) {
      return config;
    }

    const defaults = definition.fields.reduce<Record<string, any>>((acc, field) => {
      if (field.defaultValue !== undefined) {
        acc[field.fieldName] = field.defaultValue;
      }
      return acc;
    }, {});

    return {
      ...defaults,
      ...config,
    };
  }

  private decryptConfig(
    config: any & { providerType: { name: string; displayName: string; category: string } },
  ): DecryptedProviderConfig {
    const credentials = this.encryption.decrypt(config.encryptedCredentials);
    const decryptedConfig = JSON.parse(credentials);

    const fullConfig = this.applyConfigDefaults(config.providerType.name, {
      ...decryptedConfig,
      ...config.configMetadata,
    });

    return {
      id: config.id,
      providerTypeId: config.providerTypeId,
      name: config.name,
      providerType: {
        id: config.providerType.id,
        name: config.providerType.name,
        displayName: config.providerType.displayName,
        category: config.providerType.category,
      },
      config: fullConfig,
      isDefault: config.isDefault,
      isEnabled: config.isEnabled,
      priority: config.priority,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private redactConfigForDisplay(config: DecryptedProviderConfig): DecryptedProviderConfig {
    const definition = getProviderDefinition(config.providerType.name);
    if (!definition) {
      return config;
    }

    const redactedConfig = { ...config.config };
    const configPreviews: Record<string, string> = {};
    for (const field of definition.fields) {
      if (field.isEncrypted && field.fieldName in redactedConfig) {
        configPreviews[field.fieldName] = this.buildEncryptedFieldPreview(
          field.fieldName,
          redactedConfig[field.fieldName],
        );
        redactedConfig[field.fieldName] = "";
      }
    }

    return {
      ...config,
      config: redactedConfig,
      configPreviews,
    };
  }

  private buildEncryptedFieldPreview(fieldName: string, value: unknown): string {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return "";
    }

    if (fieldName.toLowerCase().includes("secret") || fieldName.toLowerCase().includes("token")) {
      return "••••••••••••";
    }

    if (normalized.length <= 8) {
      return `${normalized.slice(0, 2)}••••`;
    }

    return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
  }

  async linkProviderConfigToCloudProvider(
    providerConfigId: string,
    cloudProviderId: string,
  ): Promise<void> {
    await db
      .update(cloudProvider)
      .set({ providerConfigId })
      .where(eq(cloudProvider.id, cloudProviderId));
  }

  async getProviderConfigForUse(providerName: string): Promise<Record<string, any> | null> {
    const config = await this.getProviderConfigByName(providerName);
    if (!config || !config.isEnabled) {
      return null;
    }
    return config.config;
  }

  async getProviderConfigFields(providerTypeId: string): Promise<ProviderConfigField[]> {
    const fetchedProviderType = await db.query.providerType.findFirst({
      where: eq(providerType.id, providerTypeId),
      with: {
        configFields: true,
      },
    });

    if (!fetchedProviderType) {
      throw new Error(`Provider type not found: ${providerTypeId}`);
    }

    const definition = getProviderDefinition(fetchedProviderType.name);
    const definitionFields = new Map(
      definition?.fields.map((field) => [field.fieldName, field] as const) ?? [],
    );

    return fetchedProviderType.configFields
      .map((field) => ({
        fieldName: field.fieldName,
        fieldLabel: definitionFields.get(field.fieldName)?.fieldLabel ?? field.fieldLabel,
        fieldType: definitionFields.get(field.fieldName)?.fieldType ?? field.fieldType,
        isRequired: definitionFields.get(field.fieldName)?.isRequired ?? field.isRequired,
        isEncrypted: definitionFields.get(field.fieldName)?.isEncrypted ?? field.isEncrypted,
        defaultValue:
          definitionFields.get(field.fieldName)?.defaultValue ?? field.defaultValue ?? undefined,
        options:
          (definitionFields.get(field.fieldName)?.options as any) ??
          (field.options as any) ??
          undefined,
        validationRules:
          (definitionFields.get(field.fieldName)?.validationRules as any) ??
          (field.validationRules as any) ??
          undefined,
        sortOrder: definitionFields.get(field.fieldName)?.sortOrder ?? field.sortOrder,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getMissingRequiredFields(config: DecryptedProviderConfig): Promise<string[]> {
    const fields = await this.getProviderConfigFields(config.providerTypeId);
    const resolvedConfig = this.applyConfigDefaults(config.providerType.name, config.config);

    return fields
      .filter((field) => field.isRequired)
      .filter((field) => {
        const value = resolvedConfig[field.fieldName];

        if (value === null || value === undefined) {
          return true;
        }

        if (typeof value === "string" && value.trim() === "") {
          return true;
        }

        return false;
      })
      .map((field) => field.fieldLabel || field.fieldName);
  }
}

let providerConfigService: ProviderConfigService | null = null;

export function getProviderConfigService(): ProviderConfigService {
  if (!providerConfigService) {
    providerConfigService = new ProviderConfigService();
  }
  return providerConfigService;
}
