import { Box } from "@upstash/box";
import env from "@gitterm/env/server";
import type { UpstashImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceProvisioningSpec,
  WorkspaceStatusResult,
} from "../compute";
import { resolveProvisioningSpec } from "../provisioning-spec";
import { createProvisionLogger } from "../provision-logger";
import type {
  WorkspaceSSHAccess,
  WorkspaceSSHAccessCleanupConfig,
  WorkspaceSSHAccessConfig,
} from "../ssh-access";
import type { UpstashConfig } from "./types";

export type { UpstashConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/workspace/home";
const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;

type UpstashBox = Awaited<ReturnType<typeof Box.get>>;

function getBearerAccess(token: string): UpstreamAccess {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export class UpstashProvider implements ComputeProvider {
  readonly name = "upstash";

  async getConfig(): Promise<UpstashConfig> {
    const config = await getProviderConfigService().getProviderConfigForUse(this.name);
    if (!config) {
      throw new Error(
        "Upstash Box provider is not configured. Please configure it in the admin panel.",
      );
    }
    return config as UpstashConfig;
  }

  private async getApiKey(): Promise<string> {
    const { apiKey } = await this.getConfig();
    if (!apiKey) {
      throw new Error("Upstash Box API key is not configured.");
    }
    return apiKey;
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

  private getRepoDir(spec: WorkspaceProvisioningSpec | null): string {
    return `${WORKSPACE_DIR}/${spec?.repo?.name ?? "workspace"}`;
  }

  private getImageMetadata(config: WorkspaceConfig): UpstashImageProviderMetadata {
    const metadata = config.imageProviderMetadata?.upstash as
      | UpstashImageProviderMetadata
      | undefined;
    if (!metadata?.runtime) {
      throw new Error(`Image ${config.imageId} has no Upstash runtime metadata configured.`);
    }
    return metadata;
  }

  private getEnvironment(config: WorkspaceConfig, spec: WorkspaceProvisioningSpec | null) {
    return Object.fromEntries(
      Object.entries({ ...config.environmentVariables, ...spec?.agent.env }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as Record<string, string>;
  }

  private async getBox(externalId: string): Promise<UpstashBox> {
    return Box.get(externalId, { apiKey: await this.getApiKey() });
  }

  private async runCommand(box: UpstashBox, command: string, context: string): Promise<void> {
    const run = await box.exec.command(command);
    if (run.exitCode !== 0) {
      throw new Error(`Upstash Box ${context} failed: ${run.result}`);
    }
  }

  private async writeAgentFiles(box: UpstashBox, spec: WorkspaceProvisioningSpec | null) {
    for (const file of spec?.agent.files ?? []) {
      const path = file.path.startsWith("~/")
        ? `${WORKSPACE_DIR}/${file.path.slice(2)}`
        : file.path;
      await box.files.write({ path, content: file.contentBase64, encoding: "base64" });
    }
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const logger = createProvisionLogger(this.name, config.workspaceId);
    const apiKey = await this.getApiKey();
    const spec = resolveProvisioningSpec(config);
    const metadata = this.getImageMetadata(config);
    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;
    const repoDir = this.getRepoDir(spec);
    const box = await logger.step("create-box", () =>
      Box.create({
        apiKey,
        name: `gitterm-${config.workspaceId}`,
        runtime: metadata.runtime,
        size: metadata.size,
        env: this.getEnvironment(config, spec),
        git: spec?.repo?.authToken ? { token: spec.repo.authToken } : undefined,
        labels: [`gitterm:${config.workspaceId}`],
      }),
    );

    try {
      await logger.step("create-workspace-directory", () =>
        this.runCommand(box, `mkdir -p "${repoDir}"`, "create workspace directory"),
      );
      await box.cd(repoDir);

      if (spec?.repo) {
        await logger.step("clone-repository", () =>
          box.git.clone({
            repo: spec.repo!.url.replace(/^https?:\/\//, "").replace(/\.git$/, ""),
            branch: spec.repo!.checkoutRef || spec.repo!.branch,
          }),
        );
        if (spec.repo.baseCommit) {
          await logger.step("checkout-base-commit", () =>
            this.runCommand(
              box,
              `git fetch --depth 1 origin ${spec.repo!.baseCommit} && git checkout --detach ${spec.repo!.baseCommit}`,
              "checkout base commit",
            ),
          );
        }
      }

      await logger.step("write-agent-files", () => this.writeAgentFiles(box, spec));
      await logger.step("start-agent-server", () =>
        this.runCommand(
          box,
          `nohup setsid bash -lc '${serve.command.replace(/'/g, `"'"'`)}' > /tmp/agent-server.log 2>&1 </dev/null &`,
          "start agent server",
        ),
      );
      const postStartCommand = spec?.agent.serve?.postStartCommand;
      if (postStartCommand) {
        await logger.step("run-post-start-command", () =>
          this.runCommand(
            box,
            `nohup setsid bash -lc '${postStartCommand.replace(/'/g, `"'"'`)}' > /tmp/agent-post-start.log 2>&1 </dev/null &`,
            "run post-start command",
          ).catch((error) => console.error("Upstash Box post-start command failed:", error)),
        );
      }

      // The agent endpoint is the workspace's primary route. User application
      // ports are only exposed later through createOrGetExposedPortDomain.
      const primaryUrl = await logger.step("create-agent-public-url", () =>
        box.getPublicURL(serve.port, { bearerToken: true }),
      );
      if (!primaryUrl.token) {
        throw new Error("Upstash Box did not return a bearer token for the agent public URL.");
      }

      const workspaceInfo: WorkspaceInfo = {
        externalServiceId: box.id,
        upstreamUrl: primaryUrl.url,
        upstreamAccess: getBearerAccess(primaryUrl.token),
        domain: this.getDomain(config.subdomain),
        serviceCreatedAt: new Date(),
      };
      if (!persistent) return workspaceInfo;
      return {
        ...workspaceInfo,
        externalVolumeId: box.id,
        volumeCreatedAt: new Date(),
      };
    } catch (error) {
      await box.delete().catch(() => undefined);
      throw error;
    }
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return (await this.provisionWorkspace(config, false)) as WorkspaceInfo;
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    return (await this.provisionWorkspace(config, true)) as PersistentWorkspaceInfo;
  }

  async execCommand(
    externalId: string,
    command: string,
  ): Promise<{ exitCode: number; stdout: string }> {
    const box = await this.getBox(externalId);
    const run = await box.exec.command(command);
    return { exitCode: run.exitCode ?? 1, stdout: run.stdout };
  }

  async pauseWorkspace(externalId: string): Promise<void> {
    await (await this.getBox(externalId)).pause();
  }

  async resumeWorkspace(externalId: string): Promise<void> {
    // Do not recreate public URLs here. User-opened ports remain closed until
    // explicitly opened again through GitTerm's existing port action.
    await (await this.getBox(externalId)).resume();
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    await (await this.getBox(externalId)).delete();
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const { status } = await (await this.getBox(externalId)).getStatus();
      if (status === "running" || status === "idle") return { status: "running" };
      if (status === "creating") return { status: "pending" };
      if (status === "paused") return { status: "paused" };
      return { status: "terminated" };
    } catch {
      return { status: "terminated" };
    }
  }

  async createOrGetExposedPortDomain(
    externalId: string,
    port: number,
  ): Promise<{
    domain: string;
    externalPortDomainId?: string;
    upstreamAccess?: UpstreamAccess;
  }> {
    const publicUrl = await (
      await this.getBox(externalId)
    ).getPublicURL(port, {
      bearerToken: true,
    });
    if (!publicUrl.token) {
      throw new Error("Upstash Box did not return a bearer token for the public URL.");
    }
    return {
      domain: publicUrl.url,
      externalPortDomainId: `${externalId}:${port}`,
      upstreamAccess: getBearerAccess(publicUrl.token),
    };
  }

  async getWorkspaceSSHAccess(_config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    throw new Error(
      "Upstash Box SSH requires the account-wide API key and is not available to users.",
    );
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(externalId: string): Promise<void> {
    const [boxId, port] = externalId.split(":");
    if (!boxId || !port) return;
    await (await this.getBox(boxId)).deletePublicURL(Number(port));
  }
}

export const upstashProvider = new UpstashProvider();
