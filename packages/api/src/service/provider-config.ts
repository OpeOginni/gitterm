import { db, eq, and } from "@gitterm/db";
import { getEncryptionService } from "./encryption";
import { providerType, providerConfig } from "@gitterm/db/schema/provider-config";
import { cloudProvider } from "@gitterm/db/schema/cloud"

import {
  getProviderDefinition,
  validateProviderConfig,
  type ProviderDefinition,
  type ProviderConfigField,
} from "@gitterm/schema/provider-registry";

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

  async getProviderConfigByName(providerName: string): Promise<DecryptedProviderConfig | null> {
    const fetchedProviderType = await db.query.providerType.findFirst({
      where: eq(providerType.name, providerName),
    });

    if (!fetchedProviderType) return null;

    const config = await db.query.providerConfig.findFirst({
      where: and(eq(providerConfig.providerTypeId, fetchedProviderType.id), eq(providerConfig.isDefault, true)),
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

    const { encrypted, metadata } = this.separateConfigFields(fetchedProviderType.name, input.config);

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

    if(!newConfig) {
      throw new Error("Issue with creating new config")
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
    updates: Partial<Omit<ProviderConfigInput, "providerTypeId">>
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
      const validation = validateProviderConfig(existing.providerType.name, updates.config);
      if (!validation.success) {
        throw new Error(`Invalid config: ${validation.errors?.join(", ")}`);
      }

      const { encrypted, metadata } = this.separateConfigFields(
        existing.providerType.name,
        updates.config
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

    if(!updated) {
      throw new Error("Issue with updating config")
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

    if(!updated) {
      throw new Error("Issue with toggling config")
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

  private separateConfigFields(providerName: string, config: Record<string, any>): {
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

  private decryptConfig(
    config: any & { providerType: { name: string; displayName: string; category: string } }
  ): DecryptedProviderConfig {
    const credentials = this.encryption.decrypt(config.encryptedCredentials);
    const decryptedConfig = JSON.parse(credentials);

    const fullConfig = {
      ...decryptedConfig,
      ...config.configMetadata,
    };

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

  async linkProviderConfigToCloudProvider(
    providerConfigId: string,
    cloudProviderId: string
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

    return fetchedProviderType.configFields
      .map((field) => ({
        fieldName: field.fieldName,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        isRequired: field.isRequired,
        isEncrypted: field.isEncrypted,
        defaultValue: field.defaultValue ?? undefined,
        options: field.options as any ?? undefined,
        validationRules: field.validationRules as any ?? undefined,
        sortOrder: field.sortOrder,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getMissingRequiredFields(config: DecryptedProviderConfig): Promise<string[]> {
    const fields = await this.getProviderConfigFields(config.providerTypeId);

    return fields
      .filter((field) => field.isRequired)
      .filter((field) => {
        const value = config.config[field.fieldName];

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
