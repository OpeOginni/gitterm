import { getRailwayClient, type RailwayClient } from "./client";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import env from "@gitterm/env/server";
import { getProviderConfigService } from "../../service/config/provider-config";
import type { RailwayConfig } from "./types";
export type { RailwayConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;

export class RailwayProvider implements ComputeProvider {
  readonly name = "railway";
  private config: RailwayConfig | null = null;

  async getConfig(): Promise<RailwayConfig> {
    if (this.config) {
      return this.config;
    }

    const dbConfig = await getProviderConfigService().getProviderConfigForUse("railway");
    if (!dbConfig) {
      console.error("Railway provider is not configured.");
      throw new Error(
        "Railway provider is not configured. Please configure it in the admin panel."
      );
    }
    this.config = dbConfig as RailwayConfig;
    return this.config;
  }

  private async getClient(): Promise<RailwayClient> {
    const railway = await getRailwayClient();
    if (!railway) {
      throw new Error(
        "Railway provider is not configured. Please configure it in the admin panel."
      );
    }
    return railway;
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    const railwayConfig = await this.getConfig();
    const railway = await this.getClient();
    const { projectId, environmentId, defaultRegion, publicRailwayDomains } = railwayConfig;

    if (!projectId) {
      throw new Error("Railway project ID is not configured");
    }

    if (!environmentId) {
      throw new Error("Railway environment ID is not configured");
    }

    const { serviceCreate } = await railway
      .ServiceCreate({
        input: {
          projectId,
          name: config.subdomain,
          variables: config.environmentVariables,
        },
      })
      .catch(async (error) => {
        console.error("Railway API Error (ServiceCreate):", error);
        throw new Error(`Railway API Error (ServiceCreate): ${error.message}`);
      });

    const defaultRegionValue = defaultRegion || "us-east4-eqdc4a";
    const multiRegionConfig =
      defaultRegionValue === config.regionIdentifier
        ? { [defaultRegionValue]: { numReplicas:1 } }
        : {
            [defaultRegionValue]: null,
            [config.regionIdentifier]: { numReplicas: 1 },
          };

    await railway
      .serviceInstanceUpdate({
        environmentId,
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
        environmentId,
        serviceId: serviceCreate.id,
        latestCommit: true,
      })
      .catch(async (error) => {
        console.error("Railway API Error (serviceInstanceDeploy):", error);
        await railway.ServiceDelete({ id: serviceCreate.id });
        throw new Error(`Railway API Error (serviceInstanceDeploy): ${error.message}`);
      });

    let publicDomain = "";
    let privateDomain = "";

    if (publicRailwayDomains) {
      const { serviceDomainCreate } = await railway
        .ServiceDomainCreate({
          environmentId,
          serviceId: serviceCreate.id,
          targetPort: 7681,
        })
        .catch(async (error) => {
          console.error("Railway API Error (ServiceDomainCreate):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (ServiceDomainCreate): ${error.message}`);
        });

      publicDomain = `https://${serviceDomainCreate.domain}`;
    } else {
      const { privateNetworks } = await railway.GetProjectPrivateNetworkId({ environmentId })
        .catch(async (error) => {
          console.error("Railway API Error (GetProjectPrivateNetworkId):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (GetProjectPrivateNetworkId): ${error.message}`);
        });

        if (!privateNetworks || privateNetworks.length === 0 || !privateNetworks[0]) {
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error("No private network found");
        }

        const privateNetworkId = privateNetworks[0].publicId;

      const { privateNetworkEndpoint } = await railway.GetPrivateNetworkEndpoint({ environmentId, privateNetworkId: privateNetworkId, serviceId: serviceCreate.id })
        .catch(async (error) => {
          console.error("Railway API Error (GetPrivateNetworkEndpoint):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (GetPrivateNetworkEndpoint): ${error.message}`);
        });

        privateDomain = privateNetworkEndpoint?.dnsName ? `http://${privateNetworkEndpoint?.dnsName}.railway.internal:7681` : `http://${config.subdomain}.railway.internal:7681`;
    }

    console.log("publicDomain", publicDomain);
    console.log("privateDomain", privateDomain);

    const upstreamUrl = publicRailwayDomains
      ? publicDomain
      : privateDomain;

    const domain = publicRailwayDomains
      ? publicDomain
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
    const railwayConfig = await this.getConfig();
    const railway = await this.getClient();
    const { projectId, environmentId, defaultRegion, publicRailwayDomains } = railwayConfig;

    if (!projectId) {
      throw new Error("Railway project ID is not configured");
    }

    if (!environmentId) {
      throw new Error("Railway environment ID is not configured");
    }

    if (!defaultRegion) {
      throw new Error("Railway default region is not configured");
    }

    const { serviceCreate } = await railway
      .ServiceCreate({
        input: {
          projectId: projectId,
          name: config.subdomain,
          variables: config.environmentVariables,
        },
      })
      .catch(async (error) => {
        console.error("Railway API Error (ServiceCreate):", error);
        throw new Error(`Railway API Error (ServiceCreate): ${error.message}`);
      });

    const multiRegionConfig =
      defaultRegion === config.regionIdentifier
        ? { [defaultRegion]: { numReplicas: 1 } }
        : {
            [defaultRegion]: null,
            [config.regionIdentifier]: { numReplicas: 1 },
          };

    await railway
      .serviceInstanceUpdate({
        environmentId: environmentId,
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
        projectId: projectId,
        environmentId: environmentId,
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
        environmentId: environmentId,
        serviceId: serviceCreate.id,
        latestCommit: true,
      })
      .catch(async (error) => {
        console.error("Railway API Error (serviceInstanceDeploy):", error);
        await railway.ServiceDelete({ id: serviceCreate.id });
        throw new Error(`Railway API Error (serviceInstanceDeploy): ${error.message}`);
      });

    let publicDomain = "";
    let privateDomain = "";

    if (publicRailwayDomains) {
      const { serviceDomainCreate } = await railway
        .ServiceDomainCreate({
          environmentId: environmentId,
          serviceId: serviceCreate.id,
          targetPort: 7681,
        })
        .catch(async (error) => {
          console.error("Railway API Error (ServiceDomainCreate):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (ServiceDomainCreate): ${error.message}`);
        });

      publicDomain = `https://${serviceDomainCreate.domain}`;
    } else {
      const { privateNetworks } = await railway.GetProjectPrivateNetworkId({ environmentId: environmentId })
        .catch(async (error) => {
          console.error("Railway API Error (GetProjectPrivateNetworkId):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (GetProjectPrivateNetworkId): ${error.message}`);
        });

        if (!privateNetworks || privateNetworks.length === 0 || !privateNetworks[0]) {
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error("No private network found");
        }

        const privateNetworkId = privateNetworks[0].publicId;

      const { privateNetworkEndpoint } = await railway.GetPrivateNetworkEndpoint({ environmentId: environmentId, privateNetworkId: privateNetworkId, serviceId: serviceCreate.id })
        .catch(async (error) => {
          console.error("Railway API Error (GetPrivateNetworkEndpoint):", error);
          await railway.ServiceDelete({ id: serviceCreate.id });
          throw new Error(`Railway API Error (GetPrivateNetworkEndpoint): ${error.message}`);
        });

        privateDomain = privateNetworkEndpoint?.dnsName ? `http://${privateNetworkEndpoint?.dnsName}.railway.internal:7681` : `http://${config.subdomain}.railway.internal:7681`;
    }


    console.log("publicDomain", publicDomain);
    console.log("privateDomain", privateDomain);

    const upstreamUrl = publicRailwayDomains
      ? publicDomain
      : privateDomain;

    const domain = publicRailwayDomains
      ? publicDomain
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
    const railwayConfig = await this.getConfig();
    const railway = await this.getClient();
    const { environmentId } = railwayConfig;

    if (!environmentId) {
      throw new Error("Railway environment ID is not configured");
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
    const railwayConfig = await this.getConfig();
    const railway = await this.getClient();
    const { environmentId } = railwayConfig;

    if (!environmentId) {
      throw new Error("Railway environment ID is not configured");
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
    const railway = await this.getClient();
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
    const railway = await this.getClient();
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

  async createOrGetExposedPortDomain(externalServiceId: string, port: number): Promise<{ domain: string, externalPortDomainId?: string }> {
    const railwayConfig = await this.getConfig();
    const railway = await this.getClient();
    const { environmentId, publicRailwayDomains } = railwayConfig;

    if (!environmentId) {
      throw new Error("Railway environment ID is not configured");
    }

    if (publicRailwayDomains) {
      const { serviceDomainCreate } = await railway
      .ServiceDomainCreate({
        environmentId: environmentId,
        serviceId: externalServiceId,
        targetPort: port,
      })
      .catch(async (error) => {
        console.error("Railway API Error (ServiceDomainCreate):", error);
        throw new Error(`Railway API Error (ServiceDomainCreate): ${error.message}`);
      });

      return { domain: `https://${serviceDomainCreate.domain}`, externalPortDomainId: serviceDomainCreate.id };
    }

    const { privateNetworks } = await railway.GetProjectPrivateNetworkId({ environmentId: environmentId })
      .catch(async (error) => {
        console.error("Railway API Error (GetProjectPrivateNetworkId):", error);
        throw new Error(`Railway API Error (GetProjectPrivateNetworkId): ${error.message}`);
      });

    if (!privateNetworks || privateNetworks.length === 0 || !privateNetworks[0]) {
      throw new Error("No private network found");
    }

    const privateNetworkId = privateNetworks[0].publicId;

    const { privateNetworkEndpoint } = await railway.GetPrivateNetworkEndpoint({ environmentId: environmentId, privateNetworkId: privateNetworkId, serviceId: externalServiceId })
      .catch(async (error) => {
        console.error("Railway API Error (GetPrivateNetworkEndpoint):", error);
        throw new Error(`Railway API Error (GetPrivateNetworkEndpoint): ${error.message}`);
      });


    const domain = privateNetworkEndpoint?.dnsName ? `http://${privateNetworkEndpoint?.dnsName}.railway.internal:${port}` : `http://${externalServiceId}.railway.internal:${port}`;

    return { domain };
  }

  async removeExposedPortDomain(externalServiceDomainId: string): Promise<void> {
    const railwayConfig = await this.getConfig();
    const railway = await this.getClient();
    if (railwayConfig) {
      await railway.ServiceDomainDelete({ serviceDomainId: externalServiceDomainId }).catch((error) => {
        console.error("Railway API Error (ServiceDomainDelete):", error);
        throw new Error(`Railway API Error (ServiceDomainDelete): ${error.message}`);
      });
    }
  }
}

// Singleton instance
export const railwayProvider = new RailwayProvider();
