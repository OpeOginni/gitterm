import env from "@gitterm/env/server";
import { Daytona } from "@daytonaio/sdk";
import path from "path";
import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import type { DaytonaConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const OPENCODE_SERVER_SESSION_ID = "gitterm-opencode-server";
const REPO_NAME_LABEL = "gitterm_repo_name";
const WORKSPACE_ID_LABEL = "gitterm_workspace_id";
const PERSISTENT_LABEL = "gitterm_persistent";

type DaytonaSandbox = Awaited<ReturnType<Daytona["get"]>>;

function getTrafficAccessHeaders(token: string): UpstreamAccess {
  return {
    headers: {
      "x-daytona-preview-token": token,
      "X-Daytona-Skip-Preview-Warning": "true",
    },
  };
}

function getWorkspaceDir(): string {
  return "workspace";
}

function getRepoDir(repoName?: string): string {
  return repoName ? path.posix.join(getWorkspaceDir(), repoName) : getWorkspaceDir();
}

function toDate(value?: string | number | Date | null): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return new Date();
}

export class DaytonaProvider implements ComputeProvider {
  readonly name = "daytona";
  private config: DaytonaConfig | null = null;

  async getConfig(): Promise<DaytonaConfig> {
    if (this.config) {
      return this.config;
    }

    const dbConfig = await getProviderConfigService().getProviderConfigForUse("daytona");
    if (!dbConfig) {
      console.error("Daytona provider is not configured.");
      throw new Error(
        "Daytona provider is not configured. Please configure it in the admin panel.",
      );
    }

    this.config = dbConfig as DaytonaConfig;
    return this.config;
  }

  private async createClient(pickedRegion?: string): Promise<Daytona> {
    const { apiKey, defaultTargetRegion } = await this.getConfig();

    if (!apiKey) {
      throw new Error("Daytona Api Key not configured");
    }

    if (!defaultTargetRegion) {
      throw new Error("Daytona Default Target Region is not configured");
    }

    return new Daytona({ apiKey, target: pickedRegion ?? defaultTargetRegion });
  }

  private getDomain(subdomain: string): string {
    return ROUTING_MODE === "path"
      ? BASE_DOMAIN.includes("localhost")
        ? `http://${BASE_DOMAIN}/ws/${subdomain}`
        : `https://${BASE_DOMAIN}/ws/${subdomain}`
      : BASE_DOMAIN.includes("localhost")
        ? `http://${subdomain}.${BASE_DOMAIN}`
        : `https://${subdomain}.${BASE_DOMAIN}`;
  }

  private getWorkspaceLabels(config: WorkspaceConfig, persistent: boolean): Record<string, string> {
    const labels: Record<string, string> = {
      [WORKSPACE_ID_LABEL]: config.workspaceId,
      [PERSISTENT_LABEL]: String(persistent),
    };

    const repoName = config.environmentVariables?.REPO_NAME;
    if (repoName) {
      labels[REPO_NAME_LABEL] = repoName;
    }

    return labels;
  }

  private async executeCommand(
    sandbox: DaytonaSandbox,
    command: string,
    deleteOnError = false,
  ): Promise<void> {
    const response = await sandbox.process.executeCommand(command).catch(async (err) => {
      if (deleteOnError) {
        await sandbox.delete().catch(() => undefined);
      }
      console.error("Daytona sandbox command failed:", err);
      throw err;
    });

    if (response.exitCode !== 0) {
      if (deleteOnError) {
        await sandbox.delete().catch(() => undefined);
      }
      console.error("Exit code:", response.exitCode);
      console.error("Error output:", response.result);
      throw new Error(`Daytona command failed with exit code ${response.exitCode}`);
    }
  }

  private async startOpencodeServer(sandbox: DaytonaSandbox, repoName?: string): Promise<void> {
    const repoDir = getRepoDir(repoName);

    await sandbox.process.createSession(OPENCODE_SERVER_SESSION_ID).catch((error) => {
      console.error("Daytona Sandbox Error (createSession)", error);
      throw new Error(
        `Daytona Sandbox Error (createSession): ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    await sandbox.process
      .executeSessionCommand(OPENCODE_SERVER_SESSION_ID, {
        command: `cd "${repoDir}"`,
      })
      .catch((error) => {
        console.error("Daytona Sandbox Error (cd repoDir)", error);
        throw new Error(
          `Daytona Sandbox Error (cd repoDir): ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    await sandbox.process
      .executeSessionCommand(OPENCODE_SERVER_SESSION_ID, {
        command: "opencode serve --hostname 0.0.0.0 --port 4096 > /tmp/opencode.log 2>&1",
        runAsync: true,
      })
      .catch((error) => {
        console.error("Daytona Sandbox Error (opencode serve)", error);
        throw new Error(
          `Daytona Sandbox Error (opencode serve): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private getRepoNameFromSandbox(sandbox: DaytonaSandbox): string | undefined {
    const repoName = sandbox.labels?.[REPO_NAME_LABEL];
    return repoName && repoName.length > 0 ? repoName : undefined;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const daytona = await this.createClient(config.regionIdentifier);
    const repoName = config.environmentVariables?.REPO_NAME;
    const repoDir = getRepoDir(repoName);

    const sandbox = await daytona.create({
      labels: this.getWorkspaceLabels(config, persistent),
      envVars: {
        OPENCODE_SERVER_PASSWORD: config.environmentVariables?.OPENCODE_SERVER_PASSWORD ?? "",
      },
    });

    if (config.repositoryUrl && config.environmentVariables) {
      const parsedGitRepoUrl = config.repositoryUrl.endsWith(".git")
        ? config.repositoryUrl
        : `${config.repositoryUrl}.git`;

      const username = config.environmentVariables.GITHUB_APP_TOKEN
        ? config.environmentVariables.USER_GITHUB_USERNAME
        : undefined;
      const password = config.environmentVariables.GITHUB_APP_TOKEN;

      await sandbox.git
        .clone(parsedGitRepoUrl, repoDir, undefined, undefined, username, password)
        .catch(async (err) => {
          await sandbox.delete().catch(() => undefined);
          console.error("Daytona killed sandbox because of err:", err);
          throw err;
        });
    }

    if (config.environmentVariables?.OPENCODE_CONFIG_BASE64) {
      await this.executeCommand(sandbox, "mkdir -p ~/.config/opencode", true);
      await this.executeCommand(
        sandbox,
        `echo "${config.environmentVariables.OPENCODE_CONFIG_BASE64}" | base64 -d > ~/.config/opencode/opencode.json`,
        true,
      );
    }

    if (config.environmentVariables?.OPENCODE_CREDENTIALS_BASE64) {
      await this.executeCommand(sandbox, "mkdir -p ~/.local/share/opencode", true);
      await this.executeCommand(
        sandbox,
        `echo "${config.environmentVariables.OPENCODE_CREDENTIALS_BASE64}" | base64 -d > ~/.local/share/opencode/auth.json`,
        true,
      );
    }

    await this.startOpencodeServer(sandbox, repoName);

    const previewUrlData = await sandbox.getPreviewLink(4096);
    const serviceCreatedAt = toDate(sandbox.createdAt);

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: sandbox.id,
      upstreamUrl: previewUrlData.url,
      upstreamAccess: previewUrlData.token
        ? getTrafficAccessHeaders(previewUrlData.token)
        : undefined,
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt,
    };

    if (!persistent) {
      return workspaceInfo;
    }

    return {
      ...workspaceInfo,
      externalVolumeId: sandbox.id,
      volumeCreatedAt: serviceCreatedAt,
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

  async stopWorkspace(
    externalId: string,
    _regionIdentifier?: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const daytona = await this.createClient();
    const sandbox = await daytona.get(externalId);

    await sandbox.refreshData().catch(() => undefined);

    if (sandbox.state !== "stopped" && sandbox.state !== "archived") {
      await sandbox.stop().catch((error) => {
        console.error("Daytona Sandbox Error (Sandbox.stop)", error);
        throw new Error(
          `Daytona Sandbox Error (Sandbox.stop): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    await sandbox.refreshData().catch(() => undefined);

    if (sandbox.state !== "archived") {
      await sandbox.archive().catch((error) => {
        console.error("Daytona Sandbox Error (Sandbox.archive)", error);
        throw new Error(
          `Daytona Sandbox Error (Sandbox.archive): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  async restartWorkspace(
    externalId: string,
    _regionIdentifier?: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const daytona = await this.createClient();
    const sandbox = await daytona.get(externalId);

    await sandbox.start().catch((error) => {
      console.error("Daytona Sandbox Error (Sandbox.start)", error);
      throw new Error(
        `Daytona Sandbox Error (Sandbox.start): ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    await this.startOpencodeServer(sandbox, this.getRepoNameFromSandbox(sandbox));
  }

  async terminateWorkspace(externalServiceId: string, _externalVolumeId?: string): Promise<void> {
    const daytona = await this.createClient();
    const sandbox = await daytona.get(externalServiceId);

    await sandbox.delete().catch((error) => {
      console.error("Daytona Sandbox Error (Sandbox.delete)", error);
      throw new Error(
        `Daytona Sandbox Error (Sandbox.delete): ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    const daytona = await this.createClient();

    try {
      const sandbox = await daytona.get(externalId);
      await sandbox.refreshData().catch(() => undefined);

      const lastActiveAt = sandbox.updatedAt ? toDate(sandbox.updatedAt) : undefined;

      switch (sandbox.state) {
        case "started":
          return { status: "running", lastActiveAt };
        case "stopped":
        case "archived":
          return { status: "stopped", lastActiveAt };
        case "creating":
        case "starting":
        case "stopping":
        case "archiving":
        case "restoring":
        case "resizing":
          return { status: "pending", lastActiveAt };
        default:
          return { status: "terminated", lastActiveAt };
      }
    } catch (error) {
      console.error("Daytona Sandbox Error (getStatus)", error);
      return { status: "terminated" };
    }
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const daytona = await this.createClient();
    const sandbox = await daytona.get(externalServiceId);
    const previewUrlData = await sandbox.getPreviewLink(port);

    return {
      domain: previewUrlData.url,
      upstreamAccess: previewUrlData.token
        ? getTrafficAccessHeaders(previewUrlData.token)
        : undefined,
    };
  }

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // Daytona preview links are generated on demand and do not need explicit cleanup here.
  }
}

export const daytonaProvider = new DaytonaProvider();
