import { randomBytes } from "node:crypto";
import {
  createExecServerClient,
  EXEC_SERVER_PORT,
  EXEC_SERVER_SOURCE,
  EXEC_SERVER_START_COMMAND,
  execServerToken,
} from "./exec-server";
import {
  classifyFailure,
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  terminated,
  validateLifetime,
  validatePort,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "./types";

const profile = SANDBOX_PROVIDER_PROFILES.railway;
export const DEFAULT_RAILWAY_SANDBOX_IMAGE = "node:22-bookworm-slim";
const NAME_PREFIX = "gitterm-sbx-";
const DEPLOY_TIMEOUT_MS = 5 * 60_000;

type Snapshot = {
  service?: { id: string; name: string; createdAt?: string; deletedAt?: string | null } | null;
  serviceInstance?: {
    latestDeployment?: { id: string; status: string } | null;
    domains?: { serviceDomains?: Array<{ domain: string; targetPort?: number | null }> } | null;
  } | null;
  variables?: Record<string, string> | null;
};

/**
 * A Railway service running a stock Node image with the Gitterm command server as its
 * start command (Railway has no command API). Labels live in a service variable.
 * Railway never deletes a service on its own.
 */
export function createRailwaySandboxTransport(config: {
  apiKey: string;
  projectId: string;
  environmentId: string;
  apiUrl?: string;
  image?: string;
}): SandboxTransport {
  if (!config.apiKey?.trim()) throw new SandboxProviderError("auth", "Railway token is empty.");
  if (!config.projectId?.trim() || !config.environmentId?.trim())
    throw new Error("Railway sandboxes need projectId and environmentId");
  const apiUrl = config.apiUrl?.trim() || "https://backboard.railway.app/graphql/v2";
  const { environmentId, projectId } = config;

  async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
    action: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw classifyFailure("Railway", error, action);
    }
    if (response.status === 401 || response.status === 403)
      throw new SandboxProviderError(
        "auth",
        `Railway rejected the token while trying to ${action}.`,
      );
    const result = (await response.json().catch(() => ({}))) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (!response.ok || result.errors?.length) {
      const message =
        result.errors?.map((error) => error.message).join("; ") ?? `HTTP ${response.status}`;
      throw classifyFailure("Railway", new Error(message), action);
    }
    return result.data as T;
  }

  async function snapshot(id: string): Promise<Snapshot | null> {
    try {
      return await gql<Snapshot>(
        `query($serviceId: String!, $environmentId: String!, $projectId: String!) {
          service(id: $serviceId) { id name createdAt deletedAt }
          serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
            latestDeployment { id status }
            domains { serviceDomains { domain targetPort } }
          }
          variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
        }`,
        { serviceId: id, environmentId, projectId },
        "read the sandbox",
      );
    } catch (error) {
      if (error instanceof SandboxProviderError && error.code === "not_found") return null;
      throw error;
    }
  }

  const infoFrom = (id: string, data: Snapshot | null): SandboxProviderInfo => {
    if (!data?.service || data.service.deletedAt) return terminated(id);
    const status = data.serviceInstance?.latestDeployment?.status;
    let labels: Record<string, string> = {};
    try {
      labels = JSON.parse(data.variables?.GITTERM_LABELS ?? "{}");
    } catch {
      /* Not a Gitterm sandbox. */
    }
    return {
      id,
      state:
        status === "SUCCESS"
          ? "running"
          : !status || ["REMOVED", "SLEEPING", "REMOVING"].includes(status)
            ? "paused"
            : ["FAILED", "CRASHED", "SKIPPED"].includes(status)
              ? "terminated"
              : "pending",
      labels,
      startedAt: data.service.createdAt ?? null,
      expiresAt: null,
    };
  };

  async function connect(id: string) {
    const data = await snapshot(id);
    const info = infoFrom(id, data);
    if (info.state !== "running")
      throw new SandboxProviderError("not_found", `The Railway sandbox is ${info.state}.`);
    const domain = data?.serviceInstance?.domains?.serviceDomains?.[0]?.domain;
    if (!domain) throw new SandboxProviderError("provider", "The Railway sandbox has no domain.");
    return createExecServerClient(
      `https://${domain}`,
      execServerToken(config.apiKey, data!.service!.name),
      "Railway",
    );
  }

  async function deploy(id: string) {
    await gql(
      `mutation($environmentId: String!, $serviceId: String!) { serviceInstanceDeploy(environmentId: $environmentId, serviceId: $serviceId, latestCommit: true) }`,
      { environmentId, serviceId: id },
      "deploy the sandbox",
    );
    const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const data = await snapshot(id);
      const status = data?.serviceInstance?.latestDeployment?.status;
      if (status && ["FAILED", "CRASHED"].includes(status))
        throw new SandboxProviderError("provider", `The Railway deployment ended with ${status}.`);
      if (status === "SUCCESS") {
        const client = await connect(id);
        if (await client.ready()) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new SandboxProviderError(
      "timeout",
      "Timed out waiting for the Railway sandbox to start.",
    );
  }

  async function destroy(id: string) {
    try {
      await gql(`mutation($id: String!) { serviceDelete(id: $id) }`, { id }, "delete the sandbox");
    } catch (error) {
      if (!(error instanceof SandboxProviderError && error.code === "not_found")) throw error;
    }
  }

  return {
    provider: "railway",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const name = `${NAME_PREFIX}${randomBytes(6).toString("hex")}`;
      const created = await gql<{ serviceCreate: { id: string } }>(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        {
          input: {
            projectId,
            environmentId,
            name,
            variables: {
              GITTERM_LABELS: JSON.stringify(input.labels),
              GITTERM_EXEC_TOKEN: execServerToken(config.apiKey, name),
              GITTERM_EXEC_SERVER: EXEC_SERVER_SOURCE,
              PORT: String(EXEC_SERVER_PORT),
            },
          },
        },
        "create a sandbox",
      );
      const id = created.serviceCreate.id;
      try {
        await gql(
          `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
            serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
          }`,
          {
            environmentId,
            serviceId: id,
            input: {
              source: { image: input.template ?? config.image ?? DEFAULT_RAILWAY_SANDBOX_IMAGE },
              startCommand: EXEC_SERVER_START_COMMAND,
              healthcheckPath: "/healthz",
            },
          },
          "configure the sandbox",
        );
        await gql(
          `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id } }`,
          { input: { environmentId, serviceId: id, targetPort: EXEC_SERVER_PORT } },
          "create the sandbox domain",
        );
        await deploy(id);
        return infoFrom(id, await snapshot(id));
      } catch (error) {
        // Never leave a billable service behind when setup after creation fails.
        await destroy(id).catch(() => {});
        throw error;
      }
    },

    async info(id) {
      return infoFrom(id, await snapshot(id));
    },

    async list(labels) {
      const data = await gql<{
        project: { services: { edges: Array<{ node: { id: string; name: string } }> } };
      }>(
        `query($projectId: String!) { project(id: $projectId) { services { edges { node { id name } } } } }`,
        { projectId },
        "list sandboxes",
      );
      const items: SandboxProviderInfo[] = [];
      for (const { node } of data.project.services.edges) {
        if (!node.name.startsWith(NAME_PREFIX)) continue;
        const info = infoFrom(node.id, await snapshot(node.id));
        if (
          info.state !== "terminated" &&
          Object.entries(labels).every(([key, value]) => info.labels[key] === value)
        )
          items.push(info);
      }
      return items;
    },

    destroy,

    async pause(id) {
      const deployment = (await snapshot(id))?.serviceInstance?.latestDeployment;
      if (!deployment || deployment.status === "REMOVED") return;
      await gql(
        `mutation($id: String!) { deploymentRemove(id: $id) }`,
        { id: deployment.id },
        "pause the sandbox",
      );
    },

    resume: deploy,

    async run(id, command, options) {
      return (await connect(id)).run(command, options);
    },
    async writeFile(id, path, data) {
      return (await connect(id)).writeFile(path, data);
    },
    async readFile(id, path) {
      return (await connect(id)).readFile(path);
    },
    async preview(id, port) {
      validatePort(port);
      if (port === EXEC_SERVER_PORT)
        throw new Error(`Port ${EXEC_SERVER_PORT} is reserved for Gitterm in Railway sandboxes`);
      return (await connect(id)).preview(port);
    },
  };
}
