import { Sandbox } from "e2b";
import env from "@gitterm/env/server";
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
import type { E2BConfig } from "./types";

export type { E2BConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/home/user/workspace";

type E2BSandbox = Awaited<ReturnType<typeof Sandbox.connect>>;

function getTrafficAccessHeaders(token: string): UpstreamAccess {
  return {
    headers: {
      "e2b-traffic-access-token": token,
    },
  };
}

export class E2BProvider implements ComputeProvider {
  readonly name = "e2b";

  async getConfig(): Promise<E2BConfig> {
    const dbConfig = await getProviderConfigService().getProviderConfigForUse("e2b");
    if (!dbConfig) {
      console.error("E2B provider is not configured.");
      throw new Error("E2B provider is not configured. Please configure it in the admin panel.");
    }

    return dbConfig as E2BConfig;
  }

  private async getApiKey(): Promise<string> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    return apiKey;
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

  private getRepoDir(config: WorkspaceConfig): string {
    return `${WORKSPACE_DIR}/${config.environmentVariables?.REPO_NAME}`;
  }

  private async createSandbox(
    config: WorkspaceConfig,
    onTimeout: "pause" | "kill",
  ): Promise<E2BSandbox> {
    const apiKey = await this.getApiKey();

    return Sandbox.create("opencode", {
      apiKey,
      timeoutMs: 10 * 60 * 1_000,
      network: {
        allowPublicTraffic: false,
      },
      lifecycle: {
        onTimeout,
      },
      envs: {
        OPENCODE_SERVER_PASSWORD: config.environmentVariables?.OPENCODE_SERVER_PASSWORD ?? "",
      },
    });
  }

  private async connectSandbox(externalId: string): Promise<E2BSandbox> {
    const apiKey = await this.getApiKey();

    return Sandbox.connect(externalId, {
      apiKey,
    });
  }

  private async runCommand(
    sandbox: E2BSandbox,
    command: string,
    errorContext: string,
  ): Promise<void> {
    await sandbox.commands.run(command).catch(async (err) => {
      await sandbox.kill().catch(() => undefined);
      console.error(`E2B Sandbox Error (${errorContext})`, err);
      throw err;
    });
  }

  private async cloneRepository(
    sandbox: E2BSandbox,
    config: WorkspaceConfig,
    repoDir: string,
  ): Promise<void> {
    if (!config.repositoryUrl || !config.environmentVariables) {
      return;
    }

    const parsedGitRepoUrl = config.repositoryUrl.endsWith(".git")
      ? config.repositoryUrl
      : `${config.repositoryUrl}.git`;

    const username = config.environmentVariables.GITHUB_APP_TOKEN
      ? config.environmentVariables.USER_GITHUB_USERNAME
      : undefined;
    const password = config.environmentVariables.GITHUB_APP_TOKEN;

    await this.runCommand(sandbox, `mkdir -p ${WORKSPACE_DIR}`, "mkdir workspace");

    await sandbox.git
      .clone(parsedGitRepoUrl, {
        path: repoDir,
        username,
        password,
      })
      .catch(async (err) => {
        await sandbox.kill().catch(() => undefined);
        console.error("E2B Sandbox Error (git.clone)", err);
        throw err;
      });
  }

  private async writeOpencodeFiles(sandbox: E2BSandbox, config: WorkspaceConfig): Promise<void> {
    if (config.environmentVariables?.OPENCODE_CONFIG_BASE64) {
      await this.runCommand(sandbox, "mkdir -p ~/.config/opencode", "mkdir config dir");
      await this.runCommand(
        sandbox,
        `echo "${config.environmentVariables.OPENCODE_CONFIG_BASE64}" | base64 -d > ~/.config/opencode/opencode.json`,
        "write opencode config",
      );
    }

    if (config.environmentVariables?.OPENCODE_CREDENTIALS_BASE64) {
      await this.runCommand(sandbox, "mkdir -p ~/.local/share/opencode", "mkdir auth dir");
      await this.runCommand(
        sandbox,
        `echo "${config.environmentVariables.OPENCODE_CREDENTIALS_BASE64}" | base64 -d > ~/.local/share/opencode/auth.json`,
        "write opencode auth",
      );
    }
  }

  private async startOpencodeServer(sandbox: E2BSandbox, repoDir: string): Promise<void> {
    await sandbox.commands
      .run(
        `cd ${repoDir} && opencode serve --hostname 0.0.0.0 --port 4096 > /tmp/opencode.log 2>&1`,
        {
          background: true,
          onStdout: (data) => console.log(data),
          onStderr: (data) => console.error(data),
        },
      )
      .catch(async (err) => {
        await sandbox.kill().catch(() => undefined);
        console.error("E2B Sandbox Error (start opencode serve)", err);
        throw err;
      });
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    onTimeout: "pause" | "kill",
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const e2bSandbox = await this.createSandbox(config, onTimeout);
    const repoDir = this.getRepoDir(config);

    await this.cloneRepository(e2bSandbox, config, repoDir);
    await this.writeOpencodeFiles(e2bSandbox, config);
    await this.startOpencodeServer(e2bSandbox, repoDir);

    const host = e2bSandbox.getHost(4096);
    const trafficAccessToken = e2bSandbox.trafficAccessToken;

    if (!trafficAccessToken) {
      await e2bSandbox.kill().catch(() => undefined);
      throw new Error("E2B traffic access token missing");
    }

    const serviceCreatedAt = new Date((await e2bSandbox.getInfo()).startedAt);

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: e2bSandbox.sandboxId,
      upstreamUrl: `https://${host}`,
      upstreamAccess: getTrafficAccessHeaders(trafficAccessToken),
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt,
    };

    if (!persistent) {
      return workspaceInfo;
    }

    return {
      ...workspaceInfo,
      externalVolumeId: e2bSandbox.sandboxId,
      volumeCreatedAt: serviceCreatedAt,
    };
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return (await this.provisionWorkspace(config, "pause", false)) as WorkspaceInfo;
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    return (await this.provisionWorkspace(config, "kill", true)) as PersistentWorkspaceInfo;
  }

  async stopWorkspace(
    externalId: string,
    _regionIdentifier: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const apikey = await this.getApiKey();
    const e2bSandbox = await this.connectSandbox(externalId);

    await e2bSandbox.pause({ apiKey: apikey }).catch((error) => {
      console.error("E2B Sandbox Error (Sandbox.pause)", error.message);
      throw new Error(`E2B Sandbox Error (Sandbox.pause): ${error.message}`);
    });
  }

  async restartWorkspace(
    externalId: string,
    _regionIdentifier: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    await this.connectSandbox(externalId).catch((error) => {
      console.error("E2B Sandbox Error while restarting (Sandbox.connect)", error.message);
      throw new Error(`E2B Sandbox Error while restarting (Sandbox.connect): ${error.message}`);
    });
  }

  async terminateWorkspace(externalServiceId: string, _externalVolumeId?: string): Promise<void> {
    const e2bSandbox = await this.connectSandbox(externalServiceId);

    await e2bSandbox.kill().catch((error) => {
      console.error("E2B Sandbox Error (Sandbox.kill)", error.message);
      throw new Error(`E2B Sandbox Error (Sandbox.kill): ${error.message}`);
    });
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const sandbox = await this.connectSandbox(externalId);
      const info: any = await sandbox.getInfo();

      if (info.state === "paused") {
        return { status: "stopped" };
      }

      if (info.state === "running") {
        return { status: "running" };
      }

      return { status: "terminated" };
    } catch (error: any) {
      console.error("E2B Sandbox Error (getStatus)", error?.message ?? error);
      return { status: "terminated" };
    }
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const sandbox = await this.connectSandbox(externalServiceId);
    const host = sandbox.getHost(port);

    return {
      domain: `https://${host}`,
      upstreamAccess: sandbox.trafficAccessToken
        ? getTrafficAccessHeaders(sandbox.trafficAccessToken)
        : undefined,
    };
  }

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // No way to remove exposed port
  }
}

export const e2bProvider = new E2BProvider();
