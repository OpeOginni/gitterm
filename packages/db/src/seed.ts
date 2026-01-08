import { db, eq } from "./index";
import { agentType, cloudProvider, image, region } from "./schema/cloud";

/**
 * Seed data definitions
 * These define the default providers, agent types, images, and regions.
 * The seed is idempotent - it will:
 * - Add new items that don't exist
 * - Skip items that already exist (preserving their isEnabled state)
 * - Never delete or modify existing items
 */

const seedCloudProviders = [{ name: "Railway" }, { name: "AWS" }, { name: "Local" }];

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

  console.log("[seed] Database seed completed");
}
