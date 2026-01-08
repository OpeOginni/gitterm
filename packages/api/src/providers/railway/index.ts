import { railway } from "../../service/railway/railway";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import env from "@gitterm/env/server";

const PROJECT_ID = env.RAILWAY_PROJECT_ID;
const ENVIRONMENT_ID = env.RAILWAY_ENVIRONMENT_ID;
const BASE_DOMAIN = env.BASE_DOMAIN;
const RAILWAY_DEFAULT_REGION = env.RAILWAY_DEFAULT_REGION;
const PUBLIC_RAILWAY_DOMAINS = env.PUBLIC_RAILWAY_DOMAINS;
const ROUTING_MODE = env.ROUTING_MODE;

export class RailwayProvider implements ComputeProvider {
  readonly name = "railway";

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    if (!PROJECT_ID) {
      throw new Error("RAILWAY_PROJECT_ID is not set");
    }

    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    const { serviceCreate } = await railway
      .ServiceCreate({
        input: {
          projectId: PROJECT_ID,
          name: config.subdomain,
          variables: config.environmentVariables,
        },
      })
      .catch(async (error) => {
        console.error("Railway API Error (ServiceCreate):", error);
        throw new Error(`Railway API Error (ServiceCreate): ${error.message}`);
      });

    const multiRegionConfig =
      RAILWAY_DEFAULT_REGION === config.regionIdentifier
        ? { [RAILWAY_DEFAULT_REGION]: { numReplicas: 1 } }
        : {
            [RAILWAY_DEFAULT_REGION]: null,
            [config.regionIdentifier]: { numReplicas: 1 },
          };

    await railway
      .serviceInstanceUpdate({
        environmentId: ENVIRONMENT_ID,
        serviceId: serviceCreate.id,
        image: config.imageId,
        multiRegionConfig: multiRegionConfig,
      })
      .catch(async (error) => {
        console.error("Railway API Error (serviceInstanceUpdate):", error);
        await railway.ServiceDelete({ id: serviceCreate.id });
        throw new Error(`Railway API Error (serviceInstanceUpdate): ${error.message}`);
      });

    await railway
      .serviceInstanceDeploy({
        environmentId: ENVIRONMENT_ID,
        serviceId: serviceCreate.id,
        latestCommit: true,
      })
      .catch(async (error) => {
        console.error("Railway API Error (serviceInstanceDeploy):", error);
        await railway.ServiceDelete({ id: serviceCreate.id });
        throw new Error(`Railway API Error (serviceInstanceDeploy): ${error.message}`);
      });

    let publicDomain = "";

    if (PUBLIC_RAILWAY_DOMAINS) {
      const { serviceDomainCreate } = await railway
        .ServiceDomainCreate({
          environmentId: ENVIRONMENT_ID,
          serviceId: serviceCreate.id,
          targetPort: 7681,
        })
        .catch(async (error) => {
          console.error("Railway API Error (ServiceDomainCreate):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (ServiceDomainCreate): ${error.message}`);
        });

      publicDomain = serviceDomainCreate.domain;
    }

    const upstreamUrl = PUBLIC_RAILWAY_DOMAINS
      ? `https://${publicDomain}`
      : `http://${config.subdomain}.railway.internal:7681`;
    const domain = PUBLIC_RAILWAY_DOMAINS
      ? `https://${publicDomain}`
      : ROUTING_MODE === "path"
        ? BASE_DOMAIN.includes("localhost")
          ? `http://${BASE_DOMAIN}/ws/${config.subdomain}`
          : `https://${BASE_DOMAIN}/ws/${config.subdomain}`
        : BASE_DOMAIN.includes("localhost")
          ? `http://${config.subdomain}.${BASE_DOMAIN}`
          : `https://${config.subdomain}.${BASE_DOMAIN}`;

    return {
      externalServiceId: serviceCreate.id,
      upstreamUrl,
      domain,
      serviceCreatedAt: new Date(serviceCreate.createdAt),
    };
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    if (!PROJECT_ID) {
      throw new Error("RAILWAY_PROJECT_ID is not set");
    }

    if (!ENVIRONMENT_ID) {
      throw new Error("RAILWAY_ENVIRONMENT_ID is not set");
    }

    const { serviceCreate } = await railway
      .ServiceCreate({
        input: {
          projectId: PROJECT_ID,
          name: config.subdomain,
          variables: config.environmentVariables,
        },
      })
      .catch(async (error) => {
        console.error("Railway API Error (ServiceCreate):", error);
        throw new Error(`Railway API Error (ServiceCreate): ${error.message}`);
      });

    const multiRegionConfig =
      RAILWAY_DEFAULT_REGION === config.regionIdentifier
        ? { [RAILWAY_DEFAULT_REGION]: { numReplicas: 1 } }
        : {
            [RAILWAY_DEFAULT_REGION]: null,
            [config.regionIdentifier]: { numReplicas: 1 },
          };

    await railway
      .serviceInstanceUpdate({
        environmentId: ENVIRONMENT_ID,
        serviceId: serviceCreate.id,
        image: config.imageId,
        multiRegionConfig: multiRegionConfig,
      })
      .catch(async (error) => {
        console.error("Railway API Error (serviceInstanceUpdate):", error);
        await railway.ServiceDelete({ id: serviceCreate.id });
        throw new Error(`Railway API Error (serviceInstanceUpdate): ${error.message}`);
      });

    const { volumeCreate } = await railway
      .VolumeCreate({
        projectId: PROJECT_ID,
        environmentId: ENVIRONMENT_ID,
        serviceId: serviceCreate.id,
        mountPath: "/workspace",
        region: config.regionIdentifier,
      })
      .catch(async (error) => {
        await railway.ServiceDelete({ id: serviceCreate.id });
        console.error("Railway API Error (VolumeCreate):", error);
        throw new Error(`Railway API Error (VolumeCreate): ${error.message}`);
      });

    await railway
      .serviceInstanceDeploy({
        environmentId: ENVIRONMENT_ID,
        serviceId: serviceCreate.id,
        latestCommit: true,
      })
      .catch(async (error) => {
        console.error("Railway API Error (serviceInstanceDeploy):", error);
        await railway.ServiceDelete({ id: serviceCreate.id });
        throw new Error(`Railway API Error (serviceInstanceDeploy): ${error.message}`);
      });

    let publicDomain = "";

    console.log("PUBLIC_RAILWAY_DOMAINS", PUBLIC_RAILWAY_DOMAINS);
    if (PUBLIC_RAILWAY_DOMAINS) {
      const { serviceDomainCreate } = await railway
        .ServiceDomainCreate({
          environmentId: ENVIRONMENT_ID,
          serviceId: serviceCreate.id,
          targetPort: 7681,
        })
        .catch(async (error) => {
          console.error("Railway API Error (ServiceDomainCreate):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (ServiceDomainCreate): ${error.message}`);
        });

      publicDomain = serviceDomainCreate.domain;
    }
    console.log("publicDomain", publicDomain);

    const upstreamUrl = PUBLIC_RAILWAY_DOMAINS
      ? `https://${publicDomain}`
      : `http://${config.subdomain}.railway.internal:7681`;
    const domain = PUBLIC_RAILWAY_DOMAINS
      ? `https://${publicDomain}`
      : ROUTING_MODE === "path"
        ? BASE_DOMAIN.includes("localhost")
          ? `http://${BASE_DOMAIN}/ws/${config.subdomain}`
          : `https://${BASE_DOMAIN}/ws/${config.subdomain}`
        : BASE_DOMAIN.includes("localhost")
          ? `http://${config.subdomain}.${BASE_DOMAIN}`
          : `https://${config.subdomain}.${BASE_DOMAIN}`;

    return {
      externalServiceId: serviceCreate.id,
      externalVolumeId: volumeCreate.id,
      upstreamUrl,
      domain,
      serviceCreatedAt: new Date(serviceCreate.createdAt),
      volumeCreatedAt: new Date(volumeCreate.createdAt),
    };
  }

  async stopWorkspace(
    externalId: string,
    regionIdentifier: string,
    externalRunningDeploymentId?: string,
  ): Promise<void> {
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

  async restartWorkspace(
    externalId: string,
    regionIdentifier: string,
    externalRunningDeploymentId?: string,
  ): Promise<void> {
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

  async terminateWorkspace(externalServiceId: string, externalVolumeId?: string): Promise<void> {
    await railway.ServiceDelete({ id: externalServiceId }).catch((error) => {
      console.error("Railway API Error (ServiceDelete):", error);
      throw new Error(`Railway API Error (ServiceDelete): ${error.message}`);
    });

    if (externalVolumeId) {
      await railway.VolumeDelete({ id: externalVolumeId }).catch((error) => {
        console.error("Railway API Error (VolumeDelete):", error);
        throw new Error(`Railway API Error (VolumeDelete): ${error.message}`);
      });
    }
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
