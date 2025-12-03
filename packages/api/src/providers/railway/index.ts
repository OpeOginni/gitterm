import { railway } from "../../service/railway/railway";
import type {
  ComputeProvider,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID;
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID;
const BASE_DOMAIN = process.env.BASE_DOMAIN || "gitterm.dev";

export class RailwayProvider implements ComputeProvider {
  readonly name = "railway";

  async startWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    if (!PROJECT_ID) {
      throw new Error("RAILWAY_PROJECT_ID is not set");
    }

    const { serviceCreate } = await railway.ServiceCreate({
      input: {
        projectId: PROJECT_ID,
        name: config.subdomain,
        source: {
          image: config.imageId,
        },
        variables: config.environmentVariables,
      },
    });

    // Set the region configuration
    if (ENVIRONMENT_ID) {
      await railway.UpdateRegions({
        environmentId: ENVIRONMENT_ID,
        serviceId: serviceCreate.id,
        multiRegionConfig: {
          [config.regionIdentifier]: {
            numReplicas: 1,
          },
        },
      });
    }

    const backendUrl = `http://${config.subdomain}.railway.internal:7681`;
    const domain = `${config.subdomain}.${BASE_DOMAIN}`;

    return {
      externalId: serviceCreate.id,
      backendUrl,
      domain,
      createdAt: new Date(serviceCreate.createdAt),
    };
  }

  async stopWorkspace(externalId: string, regionIdentifier: string): Promise<void> {
    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    // Scale to 0 replicas to stop the service
    await railway.UpdateRegions({
      environmentId: ENVIRONMENT_ID,
      serviceId: externalId,
      multiRegionConfig: {
        [regionIdentifier]: {
          numReplicas: 0,
        },
      },
    });
  }

  async restartWorkspace(externalId: string, regionIdentifier: string): Promise<void> {
    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    // Scale back up to 1 replica
    await railway.UpdateRegions({
      environmentId: ENVIRONMENT_ID,
      serviceId: externalId,
      multiRegionConfig: {
        [regionIdentifier]: {
          numReplicas: 1,
        },
      },
    });
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    await railway.ServiceDelete({ id: externalId });
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    const result = await railway.Service({ id: externalId });
    
    // Railway doesn't have a direct status field, so we infer from service existence
    // In a more complete implementation, we'd check deployments status
    if (!result.service) {
      return { status: "terminated" };
    }

    // For now, assume running if the service exists
    // The actual status is tracked in our DB via webhooks
    return { status: "running" };
  }
}

// Singleton instance
export const railwayProvider = new RailwayProvider();

