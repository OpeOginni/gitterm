import { db, eq } from ".";
import { agentType, cloudProvider, image, region } from "./schema/cloud";

/**
 * Seed data definitions
 * These define the default providers, agent types, images, and regions.
 * The seed is idempotent - it will:
 * - Add new items that don't exist
 * - Skip items that already exist (preserving their isEnabled state)
 * - Never delete or modify existing items
 */

const seedCloudProviders = [
    { name: "Railway" },
    { name: "AWS" },
    { name: "Local" },
];

const seedAgentTypes = [
    { name: "OpenCode", serverOnly: false },
    { name: "OpenCode Server", serverOnly: true },
    { name: "OpenCode Web", serverOnly: false },
];

const seedImages = [
    { name: "gitterm-opencode", imageId: "opeoginni/gitterm-opencode", agentTypeName: "OpenCode" },
    { name: "gitterm-opencode-server", imageId: "opeoginni/gitterm-opencode-server", agentTypeName: "OpenCode Server" },
    { name: "gitterm-opencode-web", imageId: "opeoginni/gitterm-opencode-server", agentTypeName: "OpenCode Web" },
];

const seedRegions = [
    // Railway regions
    { name: "US West Metal", location: "California, USA", externalRegionIdentifier: "us-west2", providerName: "Railway" },
    { name: "US East Metal", location: "Virginia, USA", externalRegionIdentifier: "us-east4-eqdc4a", providerName: "Railway" },
    { name: "EU West Metal", location: "Amsterdam, Netherlands", externalRegionIdentifier: "europe-west4-drams3a", providerName: "Railway" },
    { name: "Southeast Asia Metal", location: "Singapore", externalRegionIdentifier: "asia-southeast1-eqsg3a", providerName: "Railway" },
    // Local region
    { name: "Local", location: "Local Machine", externalRegionIdentifier: "local", providerName: "Local" },
];

async function seedDB() {
    console.log("Starting database seed...");

    // =========================================================================
    // Seed Cloud Providers
    // =========================================================================
    console.log("\n📦 Seeding cloud providers...");
    const providerMap = new Map<string, string>(); // name -> id

    for (const provider of seedCloudProviders) {
        const existing = await db.query.cloudProvider.findFirst({
            where: eq(cloudProvider.name, provider.name),
        });

        if (existing) {
            console.log(`  ✓ Provider "${provider.name}" already exists (enabled: ${existing.isEnabled})`);
            providerMap.set(provider.name, existing.id);
        } else {
            const [created] = await db.insert(cloudProvider).values({
                name: provider.name,
                isEnabled: true,
            }).returning();
            console.log(`  + Created provider "${provider.name}"`);
            providerMap.set(provider.name, created!.id);
        }
    }

    // =========================================================================
    // Seed Agent Types
    // =========================================================================
    console.log("\n🤖 Seeding agent types...");
    const agentTypeMap = new Map<string, string>(); // name -> id

    for (const agent of seedAgentTypes) {
        const existing = await db.query.agentType.findFirst({
            where: eq(agentType.name, agent.name),
        });

        if (existing) {
            console.log(`  ✓ Agent type "${agent.name}" already exists (enabled: ${existing.isEnabled})`);
            agentTypeMap.set(agent.name, existing.id);
        } else {
            const [created] = await db.insert(agentType).values({
                name: agent.name,
                serverOnly: agent.serverOnly,
                isEnabled: true,
            }).returning();
            console.log(`  + Created agent type "${agent.name}"`);
            agentTypeMap.set(agent.name, created!.id);
        }
    }

    // =========================================================================
    // Seed Images
    // =========================================================================
    console.log("\n🖼️  Seeding images...");

    for (const img of seedImages) {
        const existing = await db.query.image.findFirst({
            where: eq(image.name, img.name),
        });

        if (existing) {
            console.log(`  ✓ Image "${img.name}" already exists (enabled: ${existing.isEnabled})`);
        } else {
            const agentTypeId = agentTypeMap.get(img.agentTypeName);
            if (!agentTypeId) {
                console.log(`  ⚠ Skipping image "${img.name}" - agent type "${img.agentTypeName}" not found`);
                continue;
            }

            await db.insert(image).values({
                name: img.name,
                imageId: img.imageId,
                agentTypeId,
                isEnabled: true,
            });
            console.log(`  + Created image "${img.name}"`);
        }
    }

    // =========================================================================
    // Seed Regions
    // =========================================================================
    console.log("\n🌍 Seeding regions...");

    for (const reg of seedRegions) {
        const existing = await db.query.region.findFirst({
            where: eq(region.externalRegionIdentifier, reg.externalRegionIdentifier),
        });

        if (existing) {
            console.log(`  ✓ Region "${reg.name}" already exists (enabled: ${existing.isEnabled})`);
        } else {
            const providerId = providerMap.get(reg.providerName);
            if (!providerId) {
                console.log(`  ⚠ Skipping region "${reg.name}" - provider "${reg.providerName}" not found`);
                continue;
            }

            await db.insert(region).values({
                name: reg.name,
                location: reg.location,
                externalRegionIdentifier: reg.externalRegionIdentifier,
                cloudProviderId: providerId,
                isEnabled: true,
            });
            console.log(`  + Created region "${reg.name}"`);
        }
    }

    console.log("\n✅ Database seed completed successfully!");
}

seedDB().then(() => {
    process.exit(0);
}).catch((error) => {
    console.error("\n❌ Error seeding database:", error);
    process.exit(1);
});
