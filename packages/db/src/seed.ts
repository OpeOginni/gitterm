import { db } from ".";
import { agentType, cloudProvider, image, region, type NewAgentType, type NewCloudProvider } from "./schema/cloud";


const newCloudProviders: NewCloudProvider[] = [
    {
        name: "Railway",
    },
    {
        name: "AWS",
    },
]

const newAgentTypes: NewAgentType[] = [
    {
        name: "OpenCode",
    },
    {
        name: "OpenCode Server",
        serverOnly: true,
    },
    {
        name: "OpenCode Web",
    }
]

const railwayRegions = [
    {
        name: "US West Metal",
        location: "California, USA",
        externalRegionIdentifier: "us-west2",
    },
    {
        name: "US East Metal",
        location: "Virginia, USA",
        externalRegionIdentifier: "us-east4-eqdc4a",
    },    
    {
        name: "EU West Metal",
        location: "Amsterdam, Netherlands",
        externalRegionIdentifier: "europe-west4-drams3a",
    },    
    {
        name: "Southeast Asia Metal",
        location: "Singapore",
        externalRegionIdentifier: "asia-southeast1-eqsg3a",
    },
]

async function seedDB() {

    const cloudProviders = await db.insert(cloudProvider).values(newCloudProviders).returning();

    const agents = await db.insert(agentType).values(newAgentTypes).returning();

    await db.insert(image).values([
        {
            name: "gitterm-opencode",
            imageId: "opeoginni/gitterm-opencode",
            agentTypeId: agents[0]?.id ?? "",
        },
        {
            name: "gitterm-opencode-server",
            imageId: "opeoginni/gitterm-opencode-server",
            agentTypeId: agents[1]?.id ?? "",
        },
        {
            name: "gitterm-opencode-web",
            imageId: "opeoginni/gitterm-opencode-web",
            agentTypeId: agents[2]?.id ?? "",
        },
    ])
    await db.insert(region).values(
        railwayRegions.map((region) => ({
            name: region.name,
            location: region.location,
            externalRegionIdentifier: region.externalRegionIdentifier,
            cloudProviderId: cloudProviders[0]?.id ?? "",
        })),
    )
}

seedDB().then(() => {
    console.log("DB seeded successfully");
    process.exit(0);
}).catch((error) => {
    console.error("Error seeding DB", error);
    process.exit(1);
})

// yarn db:seed