import { DeploymentStatus, railway } from "../../service/railway/railway";
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

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    if (!PROJECT_ID) {
      throw new Error("RAILWAY_PROJECT_ID is not set");
    }

    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    const { serviceCreate } = await railway.ServiceCreate({
      input: {
        projectId: PROJECT_ID,
        name: config.subdomain,
        // source: {
        //   image: config.imageId,
        // },
        variables: config.environmentVariables,
      },
    }).catch(async (error) => {
      console.error("Railway API Error (ServiceCreate):", error);
      throw new Error(`Railway API Error (ServiceCreate): ${error.message}`);
    });

    await railway.UpdateRegions({
      environmentId: ENVIRONMENT_ID,
      serviceId: serviceCreate.id,
      multiRegionConfig: {
        [config.regionIdentifier]: {
          numReplicas: 1,
        },
      },
    }).catch(async (error) => {
      console.error("Railway API Error (UpdateRegions):", error);
      await railway.ServiceDelete({ id: serviceCreate.id })
      await railway.VolumeDelete({ id: volumeCreate.id })
      throw new Error(`Railway API Error (UpdateRegions): ${error.message}`);
    });

    console.log("UpdateRegions to region:", config.regionIdentifier);

    const { volumeCreate } = await railway.VolumeCreateNoRegion({
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      serviceId: serviceCreate.id,
      mountPath: "/workspace",
      // region: config.regionIdentifier,
    }).catch(async (error) => {
      await railway.ServiceDelete({ id: serviceCreate.id })
      console.error("Railway API Error (VolumeCreate):", error);
      throw new Error(`Railway API Error (VolumeCreate): ${error.message}`);
    });

    console.log("VolumeCreateNoRegion to region:", config.regionIdentifier);

    const deploymentId = serviceCreate.project.environments.edges[0]?.node.deployments.edges[0]?.node.id;

    if (!deploymentId) {
      throw new Error("No deployment found");
    }

    // // Redeploy the deplyoment after volume creation to ensure the volume is attached to the service
    // await railway.DeploymentRemove({ id: deploymentId }).catch(async (error) => {
    //   console.error("Railway API Error (DeploymentRemove):", error);
    //   throw new Error(`Railway API Error (DeploymentRemove): ${error.message}`);
    // });


    // await railway.DeploymentRedeploy({ id: deploymentId }).catch(async (error) => {
    //   console.error("Railway API Error (DeploymentRedeploy):", error);
    //   throw new Error(`Railway API Error (DeploymentRedeploy): ${error.message}`);
    // });


    await railway.serviceInstanceUpdateAndDeployV1({
      environmentId: ENVIRONMENT_ID,
      serviceId: serviceCreate.id,
      image: config.imageId,
      // region: config.regionIdentifier,
    }).catch(async (error) => {
      console.error("Railway API Error (serviceInstanceUpdate):", error);
      throw new Error(`Railway API Error (serviceInstanceUpdate): ${error.message}`);
    });

    console.log("serviceInstanceUpdateAndDeployV1 to region:", config.regionIdentifier);

    const backendUrl = `http://${config.subdomain}.railway.internal:7681`;
    const domain = `${config.subdomain}.${BASE_DOMAIN}`;

    return {
      externalServiceId: serviceCreate.id,
      externalVolumeId: volumeCreate.id,
      backendUrl,
      domain,
      serviceCreatedAt: new Date(serviceCreate.createdAt),
      volumeCreatedAt: new Date(volumeCreate.createdAt),
    };
  }

  async stopWorkspace(externalId: string, regionIdentifier: string, externalRunningDeploymentId?: string): Promise<void> {
    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    if (!externalRunningDeploymentId) {
      throw new Error("No running deployment found");
    }

    await railway.DeploymentRemove({ id: externalRunningDeploymentId }).catch((error) => {
      console.error("Railway API Error (DeploymentRemove):", error);
      throw new Error(`Railway API Error (DeploymentRemove): ${error.message}`);
    });
  }

  async restartWorkspace(externalId: string, regionIdentifier: string, externalRunningDeploymentId?: string): Promise<void> {
    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    if (!externalRunningDeploymentId) {
      throw new Error("No running deployment found");
    }

    await railway.DeploymentRedeploy({ id: externalRunningDeploymentId }).catch((error) => {
      console.error("Railway API Error (DeploymentRedeploy):", error);
      throw new Error(`Railway API Error (DeploymentRedeploy): ${error.message}`);
    });
  }

  async terminateWorkspace(externalServiceId: string, externalVolumeId: string): Promise<void> {
    await railway.ServiceDelete({ id: externalServiceId }).catch((error) => {
      console.error("Railway API Error (ServiceDelete):", error);
      throw new Error(`Railway API Error (ServiceDelete): ${error.message}`);
    });

    await railway.VolumeDelete({ id: externalVolumeId }).catch((error) => {
      console.error("Railway API Error (VolumeDelete):", error);
      throw new Error(`Railway API Error (VolumeDelete): ${error.message}`);
    });
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

