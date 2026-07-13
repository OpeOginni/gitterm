import env from "@gitterm/env/server";
import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceProvisioningSpec,
  WorkspaceStatusResult,
  WorkspaceInfo,
} from "../compute";
import { resolveProvisioningSpec } from "../provisioning-spec";
import { createProvisionLogger } from "../provision-logger";
import type {
  WorkspaceSSHAccess,
  WorkspaceSSHAccessCleanupConfig,
  WorkspaceSSHAccessConfig,
} from "../ssh-access";
import type { CloudflareConfig, ResolvedCloudflareComputeConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const OPENCODE_PORT = 4096;
const WORKSPACE_DIR = "/workspace";

const HEADER_SANDBOX_ID = "x-gitterm-cf-sandbox-id";
const HEADER_INTERNAL_KEY = "x-gitterm-cf-internal-key";
const HEADER_PORT = "x-gitterm-cf-port";

/** Serialized handle stored as the workspace's externalInstanceId. */
interface CloudflareExternalServiceId {
  sandboxId: string;
  workerUrl: string;
  subdomain: string;
}

interface ProvisionRepo {
  url: string;
  branch?: string;
  baseCommit?: string;
  checkoutRef?: string;
  name?: string;
  authUsername?: string;
  authToken?: string;
}

interface ProvisionPayload {
  sandboxId: string;
  repo?: ProvisionRepo;
  /** Agent files to write before starting the server. */
  agentFiles?: { path: string; contentBase64: string }[];
  serverPassword?: string;
  environmentVariables?: Record<string, string>;
  workspaceProfile?: string;
  /** Command that starts the agent server inside the sandbox. */
  startCommand: string;
  /** Port the agent server listens on. */
  port: number;
  /** Commands to run before starting the server (e.g. install the agent). */
  setupCommands?: string[];
}

interface AgentRuntime {
  startCommand: string;
  port: number;
  setupCommands?: string[];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function serializeHandle(value: CloudflareExternalServiceId): string {
  return JSON.stringify(value);
}

function parseHandle(externalId: string): CloudflareExternalServiceId {
  try {
    const parsed = JSON.parse(externalId) as CloudflareExternalServiceId;
    if (!parsed?.sandboxId || !parsed?.workerUrl) {
      throw new Error("missing fields");
    }
    return parsed;
  } catch {
    throw new Error(`Invalid Cloudflare external service id: ${externalId}`);
  }
}

export class CloudflareComputeProvider implements ComputeProvider {
  readonly name = "cloudflare";

  async getConfig(): Promise<CloudflareConfig | null> {
    try {
      const config = await getProviderConfigService().getProviderConfigForUse("cloudflare");
      return (config as CloudflareConfig) ?? null;
    } catch (error) {
      console.warn("[CloudflareComputeProvider] Failed to load config:", error);
      return null;
    }
  }

  private async requireConfig(): Promise<ResolvedCloudflareComputeConfig> {
    const config = await this.getConfig();

    if (!config?.workerUrl || !config?.internalApiKey) {
      throw new Error(
        "Cloudflare sandbox is not configured. Deploy the sandbox worker and set its URL + internal key in the admin panel.",
      );
    }

    return {
      workerUrl: trimTrailingSlash(config.workerUrl),
      internalApiKey: config.internalApiKey,
    };
  }

  /** Cloudflare sandbox ids must be lowercase for preview/normalizeId routing. */
  private sandboxIdFor(workspaceId: string): string {
    return workspaceId.toLowerCase();
  }

  private getDomain(subdomain: string): string {
    if (ROUTING_MODE === "path") {
      return BASE_DOMAIN.includes("localhost")
        ? `http://${BASE_DOMAIN}/ws/${subdomain}`
        : `https://${BASE_DOMAIN}/ws/${subdomain}`;
    }

    return BASE_DOMAIN.includes("localhost")
      ? `http://${subdomain}.${BASE_DOMAIN}`
      : `https://${subdomain}.${BASE_DOMAIN}`;
  }

  private getUpstreamAccess(
    sandboxId: string,
    internalApiKey: string,
    port?: number,
  ): UpstreamAccess {
    const headers: Record<string, string> = {
      [HEADER_SANDBOX_ID]: sandboxId,
      [HEADER_INTERNAL_KEY]: internalApiKey,
    };

    if (port && port !== OPENCODE_PORT) {
      headers[HEADER_PORT] = String(port);
    }

    return { headers };
  }

  /**
   * Resolve what to run for this workspace from the image's cloudflare
   * metadata, falling back to opencode defaults. This is how new agent types
   * plug in: assign them an image carrying `providerMetadata.cloudflare`.
   */
  private resolveAgentRuntime(config: WorkspaceConfig): AgentRuntime {
    const meta = config.imageProviderMetadata?.cloudflare;
    const startCommand = meta?.startCommand?.trim();
    const port = meta?.port;

    if (!startCommand || !port) {
      throw new Error(
        `Cloudflare image "${config.imageId}" is missing required run details. ` +
          `Set providerMetadata.cloudflare.startCommand and .port on the image ` +
          `assigned to this agent type.`,
      );
    }

    return { startCommand, port, setupCommands: meta?.setupCommands };
  }

  private buildProvisionPayload(
    sandboxId: string,
    spec: WorkspaceProvisioningSpec | null,
    config: WorkspaceConfig,
    runtime: AgentRuntime,
  ): ProvisionPayload {
    const environmentVariables = Object.fromEntries(
      Object.entries(config.environmentVariables ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );

    return {
      sandboxId,
      repo: spec?.repo
        ? {
            url: spec.repo.url,
            branch: spec.repo.branch,
            baseCommit: spec.repo.baseCommit,
            checkoutRef: spec.repo.checkoutRef,
            name: spec.repo.name,
            authUsername: spec.repo.authUsername,
            authToken: spec.repo.authToken,
          }
        : undefined,
      agentFiles: spec?.agent.files,
      serverPassword: spec?.agent.usesServerPassword ? spec?.serverPassword : undefined,
      environmentVariables,
      workspaceProfile: spec?.workspaceProfile,
      startCommand: runtime.startCommand,
      port: runtime.port,
      setupCommands: runtime.setupCommands,
    };
  }

  private async callControl(
    workerUrl: string,
    internalApiKey: string,
    path: string,
    body: object,
  ): Promise<Response> {
    return fetch(`${workerUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${internalApiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const logger = createProvisionLogger(this.name, config.workspaceId);
    const { workerUrl, internalApiKey } = await this.requireConfig();
    const spec = resolveProvisioningSpec(config);
    const sandboxId = this.sandboxIdFor(config.workspaceId);
    const runtime = this.resolveAgentRuntime(config);
    const payload = this.buildProvisionPayload(sandboxId, spec, config, runtime);

    const response = await logger.step("provision-sandbox", () =>
      this.callControl(workerUrl, internalApiKey, "/__gitterm/provision", payload),
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Cloudflare sandbox provisioning failed (${response.status}): ${detail}`);
    }

    const handle: CloudflareExternalServiceId = {
      sandboxId,
      workerUrl,
      subdomain: config.subdomain,
    };

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: serializeHandle(handle),
      upstreamUrl: workerUrl,
      upstreamAccess: this.getUpstreamAccess(sandboxId, internalApiKey, runtime.port),
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt: new Date(),
    };

    logger.log(`workspace-ready persistent=${persistent}`);

    if (!persistent) {
      return workspaceInfo;
    }

    return {
      ...workspaceInfo,
      externalVolumeId: sandboxId,
      volumeCreatedAt: new Date(),
    };
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return (await this.provisionWorkspace(config, false)) as WorkspaceInfo;
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    return (await this.provisionWorkspace(config, true)) as PersistentWorkspaceInfo;
  }

  async pauseWorkspace(externalId: string): Promise<void> {
    const handle = parseHandle(externalId);
    const { internalApiKey } = await this.requireConfig();
    await this.callControl(handle.workerUrl, internalApiKey, "/__gitterm/stop", {
      sandboxId: handle.sandboxId,
    });
  }

  async resumeWorkspace(externalId: string): Promise<void> {
    const handle = parseHandle(externalId);
    const { internalApiKey } = await this.requireConfig();
    const response = await this.callControl(
      handle.workerUrl,
      internalApiKey,
      "/__gitterm/restart",
      { sandboxId: handle.sandboxId },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Cloudflare sandbox restart failed (${response.status}): ${detail}`);
    }
  }

  async terminateWorkspace(externalServiceId: string): Promise<void> {
    const handle = parseHandle(externalServiceId);
    const { internalApiKey } = await this.requireConfig();
    await this.callControl(handle.workerUrl, internalApiKey, "/__gitterm/terminate", {
      sandboxId: handle.sandboxId,
    }).catch(() => undefined);
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    const handle = parseHandle(externalId);

    try {
      const { internalApiKey } = await this.requireConfig();
      const response = await this.callControl(
        handle.workerUrl,
        internalApiKey,
        "/__gitterm/status",
        { sandboxId: handle.sandboxId },
      );

      if (!response.ok) {
        return { status: "paused" };
      }

      const data = (await response.json()) as { running?: boolean };
      return { status: data.running ? "running" : "paused" };
    } catch {
      return { status: "paused" };
    }
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{
    domain: string;
    externalPortDomainId?: string;
    upstreamAccess?: UpstreamAccess;
  }> {
    const handle = parseHandle(externalServiceId);
    const { internalApiKey } = await this.requireConfig();

    return {
      domain: this.getDomain(`${port}-${handle.subdomain}`),
      upstreamAccess: this.getUpstreamAccess(handle.sandboxId, internalApiKey, port),
    };
  }

  async getWorkspaceSSHAccess(_config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    throw new Error("Cloudflare sandboxes do not currently support editor SSH access.");
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // Exposed-port routing is header-based and stateless on the worker side;
    // nothing to tear down.
  }
}

export const cloudflareComputeProvider = new CloudflareComputeProvider();

// Re-export the workspace dir constant for callers that want path hints.
export { WORKSPACE_DIR as CLOUDFLARE_WORKSPACE_DIR };
