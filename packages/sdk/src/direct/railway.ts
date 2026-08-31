import {
  railwayContainerEnvironment,
  resolveDirectImage,
  waitForDirectRuntime,
} from "./provisioning.js";
import type {
  DirectProviderAdapter,
  DirectWorkspaceStatus,
  RailwayDirectProviderConfig,
} from "./types.js";

const DEFAULT_API_URL = "https://backboard.railway.app/graphql/v2";
const OPENCODE_SERVER_PORT = 7681;
const WORKSPACE_ROOT = "/workspace";
const DEPLOYMENT_TIMEOUT_MS = 5 * 60_000;

type RailwayHandle = {
  serviceId: string;
  volumeId?: string;
  domainId: string;
  domain: string;
  deploymentId: string;
};

type DeploymentStatus =
  | "BUILDING"
  | "CRASHED"
  | "DEPLOYING"
  | "FAILED"
  | "INITIALIZING"
  | "NEEDS_APPROVAL"
  | "QUEUED"
  | "REMOVED"
  | "REMOVING"
  | "SKIPPED"
  | "SLEEPING"
  | "SUCCESS"
  | "WAITING";

type LatestDeployment = { id: string; status: DeploymentStatus };

const SERVICE_CREATE = `
  mutation DirectServiceCreate($input: ServiceCreateInput!) {
    serviceCreate(input: $input) { id }
  }
`;
const SERVICE_INSTANCE_UPDATE = `
  mutation DirectServiceInstanceUpdate(
    $environmentId: String!
    $serviceId: String!
    $input: ServiceInstanceUpdateInput!
  ) {
    serviceInstanceUpdate(
      environmentId: $environmentId
      serviceId: $serviceId
      input: $input
    )
  }
`;
const VOLUME_CREATE = `
  mutation DirectVolumeCreate($input: VolumeCreateInput!) {
    volumeCreate(input: $input) { id }
  }
`;
const DOMAIN_CREATE = `
  mutation DirectDomainCreate($input: ServiceDomainCreateInput!) {
    serviceDomainCreate(input: $input) { id domain }
  }
`;
const SERVICE_DEPLOY = `
  mutation DirectServiceDeploy($environmentId: String!, $serviceId: String!) {
    serviceInstanceDeploy(
      environmentId: $environmentId
      serviceId: $serviceId
      latestCommit: true
    )
  }
`;
const LATEST_DEPLOYMENT = `
  query DirectLatestDeployment($environmentId: String!, $serviceId: String!) {
    serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
      latestDeployment { id status }
    }
  }
`;
const DEPLOYMENT_REMOVE = `
  mutation DirectDeploymentRemove($id: String!) { deploymentRemove(id: $id) }
`;
const SERVICE_DELETE = `
  mutation DirectServiceDelete($id: String!) { serviceDelete(id: $id) }
`;
const VOLUME_DELETE = `
  mutation DirectVolumeDelete($id: String!) { volumeDelete(volumeId: $id) }
`;
const DOMAIN_DELETE = `
  mutation DirectDomainDelete($id: String!) { serviceDomainDelete(id: $id) }
`;
const VARIABLE_UPSERT = `
  mutation DirectVariableUpsert($input: VariableUpsertInput!) {
    variableUpsert(input: $input)
  }
`;

function parseHandle(externalId: string): RailwayHandle {
  try {
    const handle = JSON.parse(externalId) as Partial<RailwayHandle>;
    if (
      typeof handle.serviceId !== "string" ||
      typeof handle.domainId !== "string" ||
      typeof handle.domain !== "string" ||
      typeof handle.deploymentId !== "string"
    ) {
      throw new Error("missing fields");
    }
    return {
      serviceId: handle.serviceId,
      volumeId: handle.volumeId,
      domainId: handle.domainId,
      domain: handle.domain,
      deploymentId: handle.deploymentId,
    };
  } catch {
    throw new Error("Invalid Railway direct workspace externalId");
  }
}

function workspaceStatus(status: DeploymentStatus): DirectWorkspaceStatus {
  switch (status) {
    case "SUCCESS":
      return "running";
    case "SLEEPING":
    case "REMOVED":
      return "paused";
    case "CRASHED":
    case "FAILED":
    case "SKIPPED":
      return "failed";
    case "BUILDING":
    case "DEPLOYING":
    case "INITIALIZING":
    case "NEEDS_APPROVAL":
    case "QUEUED":
    case "REMOVING":
    case "WAITING":
      return "pending";
  }
}

export function createRailwayDirectProvider(
  config: RailwayDirectProviderConfig,
): DirectProviderAdapter {
  if (!config.apiToken.trim()) throw new Error("Railway apiToken is required");
  if (!config.projectId.trim()) throw new Error("Railway projectId is required");
  if (!config.environmentId.trim()) throw new Error("Railway environmentId is required");

  const apiUrl = config.apiUrl?.trim() || DEFAULT_API_URL;
  const runtimePort = config.runtimePort ?? OPENCODE_SERVER_PORT;
  if (!Number.isInteger(runtimePort) || runtimePort < 1 || runtimePort > 65_535) {
    throw new Error("Railway runtimePort must be a valid TCP port");
  }

  const request = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`Railway API request failed (${response.status} ${response.statusText})`);
    }
    const result = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (result.errors?.length) {
      throw new Error(
        `Railway GraphQL error: ${result.errors.map((error) => error.message).join(", ")}`,
      );
    }
    if (!result.data) throw new Error("Railway GraphQL response did not include data");
    return result.data;
  };

  const latestDeployment = async (serviceId: string): Promise<LatestDeployment | undefined> => {
    const result = await request<{
      serviceInstance?: { latestDeployment?: LatestDeployment | null } | null;
    }>(LATEST_DEPLOYMENT, { environmentId: config.environmentId, serviceId });
    return result.serviceInstance?.latestDeployment ?? undefined;
  };

  const waitForDeployment = async (
    serviceId: string,
    previousDeploymentId?: string,
  ): Promise<LatestDeployment> => {
    const deadline = Date.now() + DEPLOYMENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const deployment = await latestDeployment(serviceId);
      if (deployment && deployment.id !== previousDeploymentId) {
        if (deployment.status === "SUCCESS") return deployment;
        if (["CRASHED", "FAILED", "REMOVED", "SKIPPED"].includes(deployment.status)) {
          throw new Error(`Railway deployment ${deployment.id} ended with ${deployment.status}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Timed out waiting for Railway deployment");
  };

  const waitForDeploymentRemoval = async (serviceId: string, deploymentId: string) => {
    const deadline = Date.now() + DEPLOYMENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const deployment = await latestDeployment(serviceId);
      if (!deployment || deployment.id !== deploymentId || deployment.status === "REMOVED") return;
      if (deployment.status === "FAILED" || deployment.status === "CRASHED") {
        throw new Error(`Railway deployment ${deployment.id} ended with ${deployment.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Timed out waiting for Railway deployment removal");
  };

  const removeResources = async (handle: Partial<RailwayHandle>): Promise<void> => {
    let failure: unknown;
    for (const operation of [
      handle.domainId ? () => request(DOMAIN_DELETE, { id: handle.domainId }) : undefined,
      handle.serviceId ? () => request(SERVICE_DELETE, { id: handle.serviceId }) : undefined,
      handle.volumeId ? () => request(VOLUME_DELETE, { id: handle.volumeId }) : undefined,
    ]) {
      if (!operation) continue;
      await operation().catch((error) => {
        failure ??= error;
      });
    }
    if (failure) throw failure;
  };

  return {
    name: "railway",
    capabilities: {
      persistence: "supported",
      recommendedLifecycle: "persistent",
      supportsPause: true,
      ephemeralPause: "state-losing",
      supportsKeepAlive: false,
    },
    async create(input) {
      const plan = input.provisioning;
      const handle: Partial<RailwayHandle> = {};
      const region = config.region?.trim();

      try {
        const created = await request<{ serviceCreate: { id: string } }>(SERVICE_CREATE, {
          input: {
            projectId: config.projectId,
            environmentId: config.environmentId,
            name: input.id,
            variables: railwayContainerEnvironment(plan),
          },
        });
        handle.serviceId = created.serviceCreate.id;

        await request(SERVICE_INSTANCE_UPDATE, {
          environmentId: config.environmentId,
          serviceId: handle.serviceId,
          input: {
            source: { image: resolveDirectImage(config.image) },
            ...(region ? { multiRegionConfig: { [region]: { numReplicas: 1 } } } : {}),
          },
        });

        if (input.lifecycle === "persistent") {
          const volume = await request<{ volumeCreate: { id: string } }>(VOLUME_CREATE, {
            input: {
              projectId: config.projectId,
              environmentId: config.environmentId,
              serviceId: handle.serviceId,
              mountPath: WORKSPACE_ROOT,
              ...(region ? { region } : {}),
            },
          });
          handle.volumeId = volume.volumeCreate.id;
        }

        const domain = await request<{ serviceDomainCreate: { id: string; domain: string } }>(
          DOMAIN_CREATE,
          {
            input: {
              environmentId: config.environmentId,
              serviceId: handle.serviceId,
              targetPort: runtimePort,
            },
          },
        );
        handle.domainId = domain.serviceDomainCreate.id;
        handle.domain = domain.serviceDomainCreate.domain;

        const previous = await latestDeployment(handle.serviceId);
        await request(SERVICE_DEPLOY, {
          environmentId: config.environmentId,
          serviceId: handle.serviceId,
        });
        const deployment = await waitForDeployment(handle.serviceId, previous?.id);
        handle.deploymentId = deployment.id;

        const runtime = {
          url: `https://${handle.domain}`,
          directory: `${WORKSPACE_ROOT}/${plan.repository?.name ?? "workspace"}`,
          password: input.password,
        };
        await waitForDirectRuntime(runtime);

        if (plan.repository?.authToken && handle.serviceId) {
          await request(VARIABLE_UPSERT, {
            input: {
              environmentId: config.environmentId,
              projectId: config.projectId,
              serviceId: handle.serviceId,
              name: "GITTERM_GIT_TOKEN",
              value: "",
              skipDeploys: true,
            },
          });
        }

        if (!handle.serviceId || !handle.domainId || !handle.domain || !handle.deploymentId) {
          throw new Error("Railway provisioning completed without all resource identifiers");
        }
        const completedHandle: RailwayHandle = {
          serviceId: handle.serviceId,
          volumeId: handle.volumeId,
          domainId: handle.domainId,
          domain: handle.domain,
          deploymentId: handle.deploymentId,
        };
        return { externalId: JSON.stringify(completedHandle), runtime };
      } catch (error) {
        const identifiers = Object.entries(handle)
          .filter(([, value]) => value)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ");
        try {
          await removeResources(handle);
        } catch (cleanupError) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}; cleanup failed${identifiers ? ` (${identifiers})` : ""}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            { cause: cleanupError },
          );
        }
        throw error;
      }
    },
    async status(workspace) {
      const handle = parseHandle(workspace.externalId);
      try {
        const deployment = await latestDeployment(handle.serviceId);
        return deployment ? workspaceStatus(deployment.status) : "terminated";
      } catch (error) {
        if (error instanceof Error && /not found|does not exist/i.test(error.message)) {
          return "terminated";
        }
        throw error;
      }
    },
    async pause(workspace) {
      const handle = parseHandle(workspace.externalId);
      const deployment = await latestDeployment(handle.serviceId);
      if (!deployment || deployment.status === "REMOVED") return;
      await request(DEPLOYMENT_REMOVE, { id: deployment.id });
      await waitForDeploymentRemoval(handle.serviceId, deployment.id);
    },
    async resume(workspace) {
      const handle = parseHandle(workspace.externalId);
      const previous = await latestDeployment(handle.serviceId);
      await request(SERVICE_DEPLOY, {
        environmentId: config.environmentId,
        serviceId: handle.serviceId,
      });
      await waitForDeployment(handle.serviceId, previous?.id);
      await waitForDirectRuntime(workspace.runtime);
      return workspace.runtime;
    },
    async terminate(workspace) {
      await removeResources(parseHandle(workspace.externalId));
    },
  };
}
