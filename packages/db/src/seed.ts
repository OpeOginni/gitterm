import { db, eq } from "./index";
import { agentType, cloudProvider, image, region } from "./schema/cloud";
import { modelProvider, model } from "./schema/model-credentials";

/**
 * Seed data definitions
 * These define the default providers, agent types, images, and regions.
 * The seed is idempotent - it will:
 * - Add new items that don't exist
 * - Skip items that already exist (preserving their isEnabled state)
 * - Never delete or modify existing items
 */

const seedCloudProviders = [{ name: "Railway" }, { name: "AWS" }, { name: "Local" }, { name: "Cloudflare", isSandbox: true }];

const seedAgentTypes = [
  { name: "OpenCode", serverOnly: false },
  { name: "OpenCode Server", serverOnly: true },
  { name: "OpenCode Web", serverOnly: false },
];

const seedImages = [
  { name: "gitterm-opencode", imageId: "opeoginni/gitterm-opencode", agentTypeName: "OpenCode" },
  {
    name: "gitterm-opencode-server",
    imageId: "opeoginni/gitterm-opencode-server",
    agentTypeName: "OpenCode Server",
  },
  {
    name: "gitterm-opencode-web",
    imageId: "opeoginni/gitterm-opencode-server",
    agentTypeName: "OpenCode Web",
  },
];

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
  // Local region
  {
    name: "Local",
    location: "Local Machine",
    externalRegionIdentifier: "local",
    providerName: "Local",
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
    name: "opencode-zen",
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
  }
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
    providerName: "opencode-zen",
    name: "glm-4.7-free",
    displayName: "GLM 4.7 Free",
    modelId: "opencode/glm-4.7-free",
    isFree: true,
    isRecommended: true,
  },
  {
    providerName: "opencode-zen",
    name: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    modelId: "opencode/gpt-5.1-codex",
  },
  {
    providerName: "opencode-zen",
    name: "gpt-5.2",
    displayName: "GPT-5.2",
    modelId: "opencode/gpt-5.2",
  },
  {
    providerName: "opencode-zen",
    name: "gemini-3-pro",
    displayName: "Gemini 3 Pro",
    modelId: "opencode/gemini-3-pro",
  },
  {
    providerName: "opencode-zen",
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
      console.log(`[seed]   Provider "${provider.name}" already exists`);
      providerMap.set(provider.name, existing.id);
    } else {
      const [created] = await db
        .insert(cloudProvider)
        .values({
          name: provider.name,
          isEnabled: true,
          isSandbox: provider.isSandbox ?? false,
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

  for (const img of seedImages) {
    const existing = await db.query.image.findFirst({
      where: eq(image.name, img.name),
    });

    if (existing) {
      console.log(`[seed]   Image "${img.name}" already exists`);
    } else {
      const agentTypeId = agentTypeMap.get(img.agentTypeName);
      if (!agentTypeId) {
        console.log(`[seed]   Skipping image "${img.name}" - agent type not found`);
        continue;
      }

      await db.insert(image).values({
        name: img.name,
        imageId: img.imageId,
        agentTypeId,
        isEnabled: true,
      });
      console.log(`[seed]   Created image "${img.name}"`);
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
        isFree: m.isFree ?? false,
        isEnabled: true,
        isRecommended: m.isRecommended ?? false,
      });
      console.log(`[seed]   Created model "${m.modelId}"`);
    }
  }

  console.log("[seed] Database seed completed");
}
