import { db, eq, and } from "./index";
import {
  agentType,
  cloudProvider,
  image,
  providerAgentImage,
  region,
  type CloudProviderEditorAccessSupport,
  type ProviderSettlement,
} from "./schema/cloud";
import { modelProvider, model } from "./schema/model-credentials";
import { providerType, providerConfigField } from "./schema/provider-config";
import { PROVIDER_DEFINITIONS } from "@gitterm/schema";

/**
 * Seed data definitions
 * These define the default providers, agent types, images, and regions.
 * The seed is idempotent - it will:
 * - Add new items that don't exist
 * - Update seeded metadata/config fields when definitions change
 * - Preserve enablement flags managed in admin
 * - Never delete existing items
 */

const hasSameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const seedCloudProviders: Array<{
  name: string;
  providerKey: string;
  isEnabled: boolean;
  isSandbox?: boolean;
  supportsRegions: boolean;
  allowUserRegionSelection?: boolean;
  supportServerOnly?: boolean;
  editorAccessSupport?: CloudProviderEditorAccessSupport;
  creationSettlement?: ProviderSettlement;
  stopSettlement?: ProviderSettlement;
  restartSettlement?: ProviderSettlement;
  terminationSettlement?: ProviderSettlement;
}> = [
  {
    name: "Railway",
    providerKey: "railway",
    isEnabled: false,
    supportsRegions: true,
    editorAccessSupport: {
      supported: true,
      transportKind: "managed-ssh",
      label: "Managed SSH bridge",
      description: "Connect through the Gitterm-managed SSH bridge for Railway workspaces.",
    },
    creationSettlement: "webhook" as ProviderSettlement,
    stopSettlement: "webhook" as ProviderSettlement,
    restartSettlement: "webhook" as ProviderSettlement,
    terminationSettlement: "webhook" as ProviderSettlement,
  },
  // AWS is intentionally NOT seeded. Each AWS region is its own cloud_provider
  // row, created by admins via `aws.createRegionProvider` (Add AWS Region in
  // the providers admin UI). Seeding a generic "AWS" row with multiple regions
  // attached produced ambiguous state — region resolution at deploy time falls
  // back to a shared default config and silently lands every workspace in the
  // first seeded region (typically us-east-1) regardless of which AWS provider
  // was picked. Admins must explicitly add the regions they want to use.
  {
    name: "Cloudflare",
    providerKey: "cloudflare",
    isEnabled: false,
    isSandbox: true,
    supportsRegions: false,
    supportServerOnly: true,
    editorAccessSupport: {
      supported: false,
      label: "Not supported",
      description: "This provider does not currently expose editor SSH access.",
    },
    creationSettlement: "poll" as ProviderSettlement,
    stopSettlement: "immediate" as ProviderSettlement,
    restartSettlement: "poll" as ProviderSettlement,
    terminationSettlement: "immediate" as ProviderSettlement,
  },
  {
    name: "E2B",
    providerKey: "e2b",
    isEnabled: false,
    isSandbox: true,
    supportsRegions: false,
    supportServerOnly: true,
    editorAccessSupport: {
      supported: true,
      transportKind: "proxycommand-ssh",
      label: "SSH via ProxyCommand",
      description: "Connect over SSH using an SSH config snippet and a local websocat bridge.",
      requiresLocalBinaries: ["websocat"],
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "webhook" as ProviderSettlement,
    restartSettlement: "webhook" as ProviderSettlement,
    terminationSettlement: "webhook" as ProviderSettlement,
  },
  {
    name: "Daytona",
    providerKey: "daytona",
    isEnabled: false,
    isSandbox: true,
    supportsRegions: true,
    supportServerOnly: true,
    editorAccessSupport: {
      supported: true,
      transportKind: "direct-ssh",
      label: "Native SSH",
      description: "Short-lived SSH access without any local proxy helper.",
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "immediate" as ProviderSettlement,
    restartSettlement: "immediate" as ProviderSettlement,
    terminationSettlement: "immediate" as ProviderSettlement,
  },
];

const seedAgentTypes = [
  { name: "OpenCode", serverOnly: false },
  { name: "OpenCode Server", serverOnly: true },
];

const seedImages = [
  {
    name: "gitterm-opencode",
    imageId: "opeoginni/gitterm-opencode",
    agentTypeName: "OpenCode",
    providerMetadata: {
      isDefault: true,
      aws: {
        cpu: 2048,
        memory: 4096,
        containerPort: 7681,
        healthCheckPath: "/",
      },
    },
  },
  {
    name: "gitterm-opencode-server",
    imageId: "opeoginni/gitterm-opencode-server",
    agentTypeName: "OpenCode Server",
    providerMetadata: {
      isDefault: true,
      e2b: {
        templateId: "r9xlzvdbcoocvbncrds9",
        sshTemplateId: "nxiezl38gnw32ufyloc0",
      },
      daytona: {
        snapshot: "gitterm/opencode-server-eu",
      },
    },
  },
  {
    name: "gitterm-opencode-aws-server",
    imageId: "opeoginni/gitterm-opencode-aws-server",
    agentTypeName: "OpenCode Server",
    providerMetadata: {
      aws: {
        cpu: 2048,
        memory: 4096,
        containerPort: 7681,
        healthCheckPath: "/",
      },
    },
  },
];

// AWS image assignments are NOT seeded here. They're created per-region when an
// admin calls `aws.createRegionProvider` (each AWS region is its own
// cloud_provider row), since providerAgentImage is keyed by cloudProviderId.
const seedProviderAgentImages: Array<{
  providerName: string;
  agentTypeName: string;
  imageName: string;
  workspaceProfile: string | null;
}> = [];

const seedProviderTypes = PROVIDER_DEFINITIONS;

const seedRegions = [
  // Railway regions
  {
    name: "US West Metal",
    location: "California, USA",
    externalRegionIdentifier: "us-west2",
    providerName: "Railway",
  },
  {
    name: "US East Metal",
    location: "Virginia, USA",
    externalRegionIdentifier: "us-east4-eqdc4a",
    providerName: "Railway",
  },
  {
    name: "EU West Metal",
    location: "Amsterdam, Netherlands",
    externalRegionIdentifier: "europe-west4-drams3a",
    providerName: "Railway",
  },
  {
    name: "Southeast Asia Metal",
    location: "Singapore",
    externalRegionIdentifier: "asia-southeast1-eqsg3a",
    providerName: "Railway",
  },
  // AWS regions are NOT seeded. Each AWS region is its own cloud_provider row,
  // created by admins via `aws.createRegionProvider` which attaches the
  // matching region row at creation time.
  // Daytona Regions
  {
    name: "Europe",
    location: "",
    externalRegionIdentifier: "eu",
    providerName: "Daytona",
  },
  {
    name: "United States",
    location: "",
    externalRegionIdentifier: "us",
    providerName: "Daytona",
  },
];

// =========================================================================
// Model Providers and Models Seed Data
// =========================================================================

const seedModelProviders = [
  {
    name: "anthropic",
    displayName: "Anthropic",
    authType: "api_key",
    plugin: null,
    oauthConfig: null,
  },
  {
    name: "openai",
    displayName: "OpenAI",
    authType: "api_key",
    plugin: null,
    oauthConfig: null,
  },
  {
    name: "google",
    displayName: "Google AI",
    authType: "api_key",
    plugin: null,
    oauthConfig: null,
  },
  {
    name: "opencode",
    displayName: "OpenCode Zen",
    authType: "api_key",
    plugin: null,
    oauthConfig: null,
    isRecommended: true,
  },
  {
    name: "github-copilot",
    displayName: "GitHub Copilot",
    authType: "oauth",
    plugin: "copilot-auth",
    oauthConfig: {
      clientId: "Iv1.b507a08c87ecfe98",
      deviceCodeUrl: "https://github.com/login/device/code",
      accessTokenUrl: "https://github.com/login/oauth/access_token",
      copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    },
  },
  {
    name: "openai-codex",
    displayName: "ChatGPT Pro/Plus (Codex)",
    authType: "oauth",
    plugin: "codex-auth",
    isRecommended: true,
  },
  {
    name: "zai-coding-plan",
    displayName: "Zai Coding Plan",
    authType: "api_key",
    plugin: null,
    oauthConfig: null,
  },
];

const seedModels = [
  // Anthropic models
  {
    providerName: "anthropic",
    name: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    modelId: "anthropic/claude-sonnet-4-5",
    isRecommended: true,
  },
  {
    providerName: "anthropic",
    name: "claude-opus-4-5",
    displayName: "Claude Opus 4.5",
    modelId: "anthropic/claude-opus-4-5",
  },
  // OpenAI models
  {
    providerName: "openai",
    name: "gpt-4o",
    displayName: "GPT-4o",
    modelId: "openai/gpt-4o",
  },
  {
    providerName: "openai",
    name: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    modelId: "openai/gpt-5.1-codex",
  },
  {
    providerName: "openai",
    name: "gpt-5.2",
    displayName: "GPT-5.2",
    modelId: "openai/gpt-5.2",
  },
  {
    providerName: "openai",
    name: "gpt-5.2-pro",
    displayName: "GPT-5.2 Pro",
    modelId: "openai/gpt-5.2-pro",
  },
  // Google AI models
  {
    providerName: "google",
    name: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    modelId: "google/gemini-3-pro-preview",
  },
  // GitHub Copilot models
  {
    providerName: "github-copilot",
    name: "claude-sonnet-4.5",
    displayName: "Claude Sonnet 4.5",
    modelId: "github-copilot/claude-sonnet-4.5",
    isRecommended: true,
  },
  {
    providerName: "github-copilot",
    name: "claude-opus-4.5",
    displayName: "Claude Opus 4.5",
    modelId: "github-copilot/claude-opus-4.5",
    isRecommended: true,
  },
  {
    providerName: "github-copilot",
    name: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    modelId: "github-copilot/gpt-5.1-codex",
  },
  {
    providerName: "github-copilot",
    name: "gpt-5.2",
    displayName: "GPT-5.2",
    modelId: "github-copilot/gpt-5.2",
  },
  {
    providerName: "github-copilot",
    name: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    modelId: "github-copilot/gemini-3-pro-preview",
  },
  // OpenCode models
  {
    providerName: "opencode",
    name: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    modelId: "opencode/gpt-5.1-codex",
  },
  {
    providerName: "opencode",
    name: "gpt-5.2",
    displayName: "GPT-5.2",
    modelId: "opencode/gpt-5.2",
  },
  {
    providerName: "opencode",
    name: "gemini-3-pro",
    displayName: "Gemini 3 Pro",
    modelId: "opencode/gemini-3-pro",
  },
  {
    providerName: "opencode",
    name: "claude-opus-4-5",
    displayName: "Claude Opus 4.5",
    modelId: "opencode/claude-opus-4-5",
    isRecommended: true,
  },
  // OpenAI Codex models (ChatGPT Pro/Plus subscription)
  {
    providerName: "openai-codex",
    name: "gpt-5.1-codex-max",
    displayName: "GPT-5.1 Codex Max",
    modelId: "openai-codex/gpt-5.1-codex-max",
    isRecommended: true,
  },
  {
    providerName: "openai-codex",
    name: "gpt-5.1-codex-mini",
    displayName: "GPT-5.1 Codex Mini",
    modelId: "openai-codex/gpt-5.1-codex-mini",
  },
  {
    providerName: "openai-codex",
    name: "gpt-5.2",
    displayName: "GPT-5.2",
    modelId: "openai-codex/gpt-5.2",
  },
  {
    providerName: "openai-codex",
    name: "gpt-5.2-codex",
    displayName: "GPT-5.2 Codex",
    modelId: "openai-codex/gpt-5.2-codex",
  },
  // zai-coding-plan
  {
    providerName: "zai-coding-plan",
    name: "glm-4.7",
    displayName: "GLM 4.7",
    modelId: "zai-coding-plan/glm-4.7",
  },
];

/**
 * Seed the database with initial data
 * This is idempotent - safe to run multiple times
 */
export async function seedDatabase(): Promise<void> {
  console.log("[seed] Starting database seed...");

  // =========================================================================
  // Seed Cloud Providers
  // =========================================================================
  console.log("[seed] Seeding cloud providers...");
  const providerMap = new Map<string, string>(); // name -> id

  for (const provider of seedCloudProviders) {
    const existing = await db.query.cloudProvider.findFirst({
      where: eq(cloudProvider.name, provider.name),
    });

    if (existing) {
      const updates: Partial<typeof cloudProvider.$inferInsert> = {};
      const targetIsSandbox = provider.isSandbox ?? false;
      const targetSupportsRegions = provider.supportsRegions ?? true;
      const targetAllowUserRegionSelection = provider.allowUserRegionSelection ?? true;
      const targetSupportServerOnly = provider.supportServerOnly ?? false;
      const targetProviderCreationSettlement = provider.creationSettlement ?? "webhook";
      const targetProviderStopSettlement = provider.stopSettlement ?? "webhook";
      const targetProviderRestartSettlement = provider.restartSettlement ?? "webhook";
      const targetProviderTerminationSettlement = provider.terminationSettlement ?? "webhook";
      const targetEditorAccessSupport = provider.editorAccessSupport ?? {};

      if (existing.providerKey !== provider.providerKey) {
        updates.providerKey = provider.providerKey;
      }

      if (existing.isSandbox !== targetIsSandbox) {
        updates.isSandbox = targetIsSandbox;
      }

      if (existing.supportsRegions !== targetSupportsRegions) {
        updates.supportsRegions = targetSupportsRegions;
      }

      if (existing.allowUserRegionSelection !== targetAllowUserRegionSelection) {
        updates.allowUserRegionSelection = targetAllowUserRegionSelection;
      }

      if (existing.supportServerOnly !== targetSupportServerOnly) {
        updates.supportServerOnly = targetSupportServerOnly;
      }

      if (existing.creationSettlement !== targetProviderCreationSettlement) {
        updates.creationSettlement = targetProviderCreationSettlement;
      }

      if (existing.stopSettlement !== targetProviderStopSettlement) {
        updates.stopSettlement = targetProviderStopSettlement;
      }

      if (existing.restartSettlement !== targetProviderRestartSettlement) {
        updates.restartSettlement = targetProviderRestartSettlement;
      }

      if (existing.terminationSettlement !== targetProviderTerminationSettlement) {
        updates.terminationSettlement = targetProviderTerminationSettlement;
      }

      if (!hasSameJson(existing.editorAccessSupport, targetEditorAccessSupport)) {
        updates.editorAccessSupport = targetEditorAccessSupport;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(cloudProvider)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(cloudProvider.id, existing.id));

        console.log(`[seed]   Updated provider metadata for "${provider.name}"`);
      } else {
        console.log(`[seed]   Provider "${provider.name}" already exists`);
      }

      providerMap.set(provider.name, existing.id);
    } else {
      const [created] = await db
        .insert(cloudProvider)
        .values({
          name: provider.name,
          providerKey: provider.providerKey,
          isEnabled: provider.isEnabled,
          isSandbox: provider.isSandbox ?? false,
          supportsRegions: provider.supportsRegions,
          allowUserRegionSelection: provider.allowUserRegionSelection ?? true,
          supportServerOnly: provider.supportServerOnly ?? false,
          editorAccessSupport: provider.editorAccessSupport ?? {},
          creationSettlement: provider.creationSettlement ?? "webhook",
          stopSettlement: provider.stopSettlement ?? "webhook",
          restartSettlement: provider.restartSettlement ?? "webhook",
          terminationSettlement: provider.terminationSettlement ?? "webhook",
        })
        .returning();
      console.log(`[seed]   Created provider "${provider.name}"`);
      providerMap.set(provider.name, created!.id);
    }
  }

  // =========================================================================
  // Seed Agent Types
  // =========================================================================
  console.log("[seed] Seeding agent types...");
  const agentTypeMap = new Map<string, string>(); // name -> id

  for (const agent of seedAgentTypes) {
    const existing = await db.query.agentType.findFirst({
      where: eq(agentType.name, agent.name),
    });

    if (existing) {
      console.log(`[seed]   Agent type "${agent.name}" already exists`);
      agentTypeMap.set(agent.name, existing.id);
    } else {
      const [created] = await db
        .insert(agentType)
        .values({
          name: agent.name,
          serverOnly: agent.serverOnly,
          isEnabled: true,
        })
        .returning();
      console.log(`[seed]   Created agent type "${agent.name}"`);
      agentTypeMap.set(agent.name, created!.id);
    }
  }

  // =========================================================================
  // Seed Images
  // =========================================================================
  console.log("[seed] Seeding images...");
  const imageMap = new Map<string, string>();

  for (const img of seedImages) {
    const existing = await db.query.image.findFirst({
      where: eq(image.name, img.name),
    });

    if (existing) {
      await db
        .update(image)
        .set({
          imageId: img.imageId,
          providerMetadata: img.providerMetadata ?? {},
          updatedAt: new Date(),
        })
        .where(eq(image.id, existing.id));
      console.log(`[seed]   Image "${img.name}" already exists`);
      imageMap.set(img.name, existing.id);
    } else {
      const agentTypeId = agentTypeMap.get(img.agentTypeName);
      if (!agentTypeId) {
        console.log(`[seed]   Skipping image "${img.name}" - agent type not found`);
        continue;
      }

      const [created] = await db
        .insert(image)
        .values({
          name: img.name,
          imageId: img.imageId,
          agentTypeId,
          providerMetadata: img.providerMetadata ?? {},
          isEnabled: true,
        })
        .returning();
      console.log(`[seed]   Created image "${img.name}"`);
      imageMap.set(img.name, created!.id);
    }
  }

  // =========================================================================
  // Seed Provider Image Assignments
  // =========================================================================
  console.log("[seed] Seeding provider image assignments...");

  for (const assignment of seedProviderAgentImages) {
    const cloudProviderId = providerMap.get(assignment.providerName);
    const agentTypeId = agentTypeMap.get(assignment.agentTypeName);
    const imageId = imageMap.get(assignment.imageName);

    if (!cloudProviderId || !agentTypeId || !imageId) {
      console.log(
        `[seed]   Skipping image assignment ${assignment.providerName}/${assignment.agentTypeName} - missing provider, agent type, or image`,
      );
      continue;
    }

    const existing = await db.query.providerAgentImage.findFirst({
      where: and(
        eq(providerAgentImage.cloudProviderId, cloudProviderId),
        eq(providerAgentImage.agentTypeId, agentTypeId),
      ),
    });

    if (existing) {
      await db
        .update(providerAgentImage)
        .set({
          imageId,
          workspaceProfile: assignment.workspaceProfile,
          isDefault: true,
          updatedAt: new Date(),
        })
        .where(eq(providerAgentImage.id, existing.id));
      console.log(
        `[seed]   Updated image assignment ${assignment.providerName}/${assignment.agentTypeName}`,
      );
    } else {
      await db.insert(providerAgentImage).values({
        cloudProviderId,
        agentTypeId,
        imageId,
        workspaceProfile: assignment.workspaceProfile,
        isDefault: true,
      });
      console.log(
        `[seed]   Created image assignment ${assignment.providerName}/${assignment.agentTypeName}`,
      );
    }
  }

  // =========================================================================
  // Seed Regions
  // =========================================================================
  console.log("[seed] Seeding regions...");

  for (const reg of seedRegions) {
    const existing = await db.query.region.findFirst({
      where: eq(region.externalRegionIdentifier, reg.externalRegionIdentifier),
    });

    if (existing) {
      console.log(`[seed]   Region "${reg.name}" already exists`);
    } else {
      const providerId = providerMap.get(reg.providerName);
      if (!providerId) {
        console.log(`[seed]   Skipping region "${reg.name}" - provider not found`);
        continue;
      }

      await db.insert(region).values({
        name: reg.name,
        location: reg.location,
        externalRegionIdentifier: reg.externalRegionIdentifier,
        cloudProviderId: providerId,
        isEnabled: true,
      });
      console.log(`[seed]   Created region "${reg.name}"`);
    }
  }

  // =========================================================================
  // Seed Model Providers
  // =========================================================================
  console.log("[seed] Seeding model providers...");
  const modelProviderMap = new Map<string, string>(); // name -> id

  for (const provider of seedModelProviders) {
    const existing = await db.query.modelProvider.findFirst({
      where: eq(modelProvider.name, provider.name),
    });

    if (existing) {
      console.log(`[seed]   Model provider "${provider.name}" already exists`);
      modelProviderMap.set(provider.name, existing.id);
    } else {
      const [created] = await db
        .insert(modelProvider)
        .values({
          name: provider.name,
          displayName: provider.displayName,
          authType: provider.authType,
          plugin: provider.plugin,
          oauthConfig: provider.oauthConfig,
          isEnabled: true,
          isRecommended: provider.isRecommended ?? false,
        })
        .returning();
      console.log(`[seed]   Created model provider "${provider.name}"`);
      modelProviderMap.set(provider.name, created!.id);
    }
  }

  // =========================================================================
  // Seed Models
  // =========================================================================
  console.log("[seed] Seeding models...");

  for (const m of seedModels) {
    const providerId = modelProviderMap.get(m.providerName);
    if (!providerId) {
      console.log(`[seed]   Skipping model "${m.name}" - provider not found`);
      continue;
    }

    const existing = await db.query.model.findFirst({
      where: eq(model.modelId, m.modelId),
    });

    if (existing) {
      console.log(`[seed]   Model "${m.modelId}" already exists`);
    } else {
      await db.insert(model).values({
        providerId,
        name: m.name,
        displayName: m.displayName,
        modelId: m.modelId,
        isFree: false,
        isEnabled: true,
        isRecommended: m.isRecommended ?? false,
      });
      console.log(`[seed]   Created model "${m.modelId}"`);
    }
  }

  // =========================================================================
  // Seed Provider Types
  // =========================================================================
  console.log("[seed] Seeding provider types...");
  const providerTypeMap = new Map<string, string>(); // name -> id

  const syncProviderConfigFields = async (providerTypeId: string, providerName: string) => {
    let createdCount = 0;
    let updatedCount = 0;

    for (const field of seedProviderTypes[providerName]!.fields) {
      const existingField = await db.query.providerConfigField.findFirst({
        where: and(
          eq(providerConfigField.providerTypeId, providerTypeId),
          eq(providerConfigField.fieldName, field.fieldName),
        ),
      });

      if (!existingField) {
        await db.insert(providerConfigField).values({
          providerTypeId,
          fieldName: field.fieldName,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          defaultValue: field.defaultValue,
          options: field.options ?? null,
          validationRules: field.validationRules ?? null,
          sortOrder: field.sortOrder,
        });
        createdCount += 1;
        continue;
      }

      const updates: Partial<typeof providerConfigField.$inferInsert> = {};
      const defaultValue = field.defaultValue ?? null;
      const options = field.options ?? null;
      const validationRules = field.validationRules ?? null;

      if (existingField.fieldLabel !== field.fieldLabel) {
        updates.fieldLabel = field.fieldLabel;
      }

      if (existingField.fieldType !== field.fieldType) {
        updates.fieldType = field.fieldType;
      }

      if (existingField.isRequired !== field.isRequired) {
        updates.isRequired = field.isRequired;
      }

      if (existingField.isEncrypted !== field.isEncrypted) {
        updates.isEncrypted = field.isEncrypted;
      }

      if (existingField.defaultValue !== defaultValue) {
        updates.defaultValue = defaultValue;
      }

      if (!hasSameJson(existingField.options, options)) {
        updates.options = options;
      }

      if (!hasSameJson(existingField.validationRules, validationRules)) {
        updates.validationRules = validationRules;
      }

      if (existingField.sortOrder !== field.sortOrder) {
        updates.sortOrder = field.sortOrder;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(providerConfigField)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(providerConfigField.id, existingField.id));
        updatedCount += 1;
      }
    }

    const definedFieldNames = new Set(
      seedProviderTypes[providerName]!.fields.map((field) => field.fieldName),
    );
    const allExistingFields = await db.query.providerConfigField.findMany({
      where: eq(providerConfigField.providerTypeId, providerTypeId),
    });
    let deletedCount = 0;
    for (const existing of allExistingFields) {
      if (!definedFieldNames.has(existing.fieldName)) {
        await db.delete(providerConfigField).where(eq(providerConfigField.id, existing.id));
        deletedCount += 1;
      }
    }

    if (createdCount > 0 || updatedCount > 0 || deletedCount > 0) {
      console.log(
        `[seed]   Synced config fields for "${providerName}" (created: ${createdCount}, updated: ${updatedCount}, deleted: ${deletedCount})`,
      );
    }
  };

  for (const provider of Object.values(seedProviderTypes)) {
    const existing = await db.query.providerType.findFirst({
      where: eq(providerType.name, provider.name),
    });

    if (existing) {
      const updates: Partial<typeof providerType.$inferInsert> = {};

      if (existing.displayName !== provider.displayName) {
        updates.displayName = provider.displayName;
      }

      if (existing.category !== provider.category) {
        updates.category = provider.category;
      }

      if (!hasSameJson(existing.configSchema, provider.configSchema)) {
        updates.configSchema = provider.configSchema;
      }

      if (!existing.isBuiltIn) {
        updates.isBuiltIn = true;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(providerType)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(providerType.id, existing.id));

        console.log(`[seed]   Updated provider type "${provider.name}"`);
      } else {
        console.log(`[seed]   Provider type "${provider.name}" already exists`);
      }

      providerTypeMap.set(provider.name, existing.id);

      await syncProviderConfigFields(existing.id, provider.name);
    } else {
      const [created] = await db
        .insert(providerType)
        .values({
          name: provider.name,
          displayName: provider.displayName,
          category: provider.category,
          configSchema: provider.configSchema,
          isEnabled: true,
          isBuiltIn: true,
        })
        .returning();
      console.log(`[seed]   Created provider type "${provider.name}"`);
      providerTypeMap.set(provider.name, created!.id);

      await syncProviderConfigFields(created!.id, provider.name);
    }
  }

  console.log("[seed] Database seed completed");
}
