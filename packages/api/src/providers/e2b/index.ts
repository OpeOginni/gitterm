import { Sandbox } from "e2b";
import env from "@gitterm/env/server";
import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceEnvironmentVariables,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import {
  buildHostAlias,
  buildSshCommand,
  buildSshConnectionString,
  buildStandardSshConfigSnippet,
  type WorkspaceEditorAccess,
  type WorkspaceEditorAccessCleanupConfig,
  type WorkspaceEditorAccessConfig,
} from "../editor-access";
import { createProvisionLogger } from "../provision-logger";
import type { E2BConfig } from "./types";

export type { E2BConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/home/user/workspace";
const OPENCODE_PORT = 4096;
const SSH_BRIDGE_PORT = 8081;
const SSH_USER = "user";
const SSH_REQUIRED_BINARIES = ["websocat"] as const;
const SSH_NOTES = [
  "This connection uses your saved SSH public key, so make sure the matching private key is available locally.",
  "Install websocat locally before connecting so OpenSSH can tunnel through E2B's WebSocket endpoint.",
  "On macOS you can install it with `brew install websocat`.",
] as const;

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
    const config = await getProviderConfigService().getProviderConfigForUse("e2b");

    if (!config) {
      throw new Error("E2B provider is not configured. Please configure it in the admin panel.");
    }

    return config as E2BConfig;
  }

  private async getApiKey(): Promise<string> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B API key not configured");
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

  private getSandboxEnvs(config: WorkspaceConfig): Record<string, string> {
    const envs = (config.environmentVariables ?? {}) as WorkspaceEnvironmentVariables;

    return Object.fromEntries(
      Object.entries(envs).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
  }

  private getRepoDir(config: WorkspaceConfig): string {
    const repoName = config.environmentVariables?.REPO_NAME ?? "workspace";
    return `${WORKSPACE_DIR}/${repoName}`;
  }

  private getProjectPathHint(pathHint: string): string {
    return pathHint.replace(/^\/workspace/, WORKSPACE_DIR);
  }

  private isSshEnabledWorkspace(config: WorkspaceConfig): boolean {
    return config.imageId.includes("with-ssh");
  }

  private getTemplateId(config: WorkspaceConfig): string {
    const templateId = config.imageProviderMetadata?.e2b?.templateId;

    if (!templateId) {
      throw new Error(`No E2B template ID configured for image ${config.imageId}`);
    }

    return templateId;
  }

  private getRepositoryUrl(repositoryUrl: string): string {
    return repositoryUrl.endsWith(".git") ? repositoryUrl : `${repositoryUrl}.git`;
  }

  private async createSandbox(
    config: WorkspaceConfig,
    onTimeout: "pause" | "kill",
  ): Promise<E2BSandbox> {
    return Sandbox.create(this.getTemplateId(config), {
      apiKey: await this.getApiKey(),
      timeoutMs: 10 * 60 * 1_000,
      network: {
        allowPublicTraffic: false,
      },
      lifecycle: {
        onTimeout,
      },
      envs: this.getSandboxEnvs(config),
    });
  }

  private async connectSandbox(externalId: string): Promise<E2BSandbox> {
    return Sandbox.connect(externalId, {
      apiKey: await this.getApiKey(),
    });
  }

  private async runCommand(
    sandbox: E2BSandbox,
    command: string,
    errorContext: string,
    options?: { user?: string; cwd?: string },
  ): Promise<void> {
    await sandbox.commands.run(command, options).catch(async (error) => {
      await sandbox.kill().catch(() => undefined);
      console.error(`E2B Sandbox Error (${errorContext})`, error);
      throw error;
    });
  }

  private async cloneRepository(
    sandbox: E2BSandbox,
    config: WorkspaceConfig,
    repoDir: string,
  ): Promise<void> {
    await this.runCommand(sandbox, `mkdir -p ${WORKSPACE_DIR}`, "mkdir workspace");

    if (!config.repositoryUrl || !config.environmentVariables) {
      await this.runCommand(sandbox, `mkdir -p ${repoDir}`, "mkdir empty repo dir");
      return;
    }

    await sandbox.git
      .clone(this.getRepositoryUrl(config.repositoryUrl), {
        path: repoDir,
        username: config.environmentVariables.GITHUB_APP_TOKEN
          ? config.environmentVariables.USER_GITHUB_USERNAME
          : undefined,
        password: config.environmentVariables.GITHUB_APP_TOKEN,
      })
      .catch(async (error) => {
        await sandbox.kill().catch(() => undefined);
        console.error("E2B Sandbox Error (git.clone)", error);
        throw error;
      });
  }

  private async writeOpencodeFiles(sandbox: E2BSandbox, config: WorkspaceConfig): Promise<void> {
    const envs = config.environmentVariables;

    if (envs?.OPENCODE_CONFIG_BASE64) {
      await this.runCommand(sandbox, "mkdir -p ~/.config/opencode", "mkdir config dir");
      await this.runCommand(
        sandbox,
        `echo "${envs.OPENCODE_CONFIG_BASE64}" | base64 -d > ~/.config/opencode/opencode.json`,
        "write opencode config",
      );
    }

    if (envs?.OPENCODE_CREDENTIALS_BASE64) {
      await this.runCommand(sandbox, "mkdir -p ~/.local/share/opencode", "mkdir auth dir");
      await this.runCommand(
        sandbox,
        `echo "${envs.OPENCODE_CREDENTIALS_BASE64}" | base64 -d > ~/.local/share/opencode/auth.json`,
        "write opencode auth",
      );
    }
  }

  private async configureSshRuntime(
    sandbox: E2BSandbox,
    config: WorkspaceConfig,
  ): Promise<void> {
    if (!this.isSshEnabledWorkspace(config)) {
      return;
    }

    const publicKey = config.environmentVariables?.USER_SSH_PUBLIC_KEY;
    if (!publicKey) {
      throw new Error("E2B SSH workspace requires USER_SSH_PUBLIC_KEY.");
    }

    await this.runCommand(
      sandbox,
      [
        "install -d -m 0700 /home/user/.ssh",
        "touch /home/user/.ssh/authorized_keys",
        "chmod 600 /home/user/.ssh/authorized_keys",
        `if ! grep -qxF '$USER_SSH_PUBLIC_KEY' /home/user/.ssh/authorized_keys 2>/dev/null; then printf '%s\\n' '$USER_SSH_PUBLIC_KEY' >> /home/user/.ssh/authorized_keys; fi`,
      ].join(" && "),
      "configure ssh runtime",
      { user: SSH_USER },
    );
  }

  private async waitForSshBridge(sandbox: E2BSandbox): Promise<string> {
    const bridgeHost = sandbox.getHost(SSH_BRIDGE_PORT);
    const trafficAccessToken = sandbox.trafficAccessToken;

    if (!trafficAccessToken) {
      throw new Error("E2B traffic access token missing for SSH bridge.");
    }

    const bridgeUrl = `https://${bridgeHost}`;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetch(bridgeUrl, {
          headers: {
            "e2b-traffic-access-token": trafficAccessToken,
          },
        });

        if (response.status !== 502 && response.status !== 503) {
          return bridgeHost;
        }
      } catch {
        // Ignore and retry while the bridge comes up.
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error("E2B SSH bridge did not become ready in time.");
  }

  private async getTrafficAccessToken(
    sandbox: E2BSandbox,
    errorContext: string,
  ): Promise<string> {
    const token = sandbox.trafficAccessToken;

    if (!token) {
      throw new Error(`E2B traffic access token missing for ${errorContext}.`);
    }

    return token;
  }

  private async startOpencodeServer(sandbox: E2BSandbox, repoDir: string): Promise<void> {
    await sandbox.commands
      .run(`cd ${repoDir} && opencode serve --hostname 0.0.0.0 --port ${OPENCODE_PORT} > /tmp/opencode.log 2>&1`, {
        background: true,
        onStdout: (data) => console.log(data),
        onStderr: (data) => console.error(data),
      })
      .catch(async (error) => {
        await sandbox.kill().catch(() => undefined);
        console.error("E2B Sandbox Error (start opencode serve)", error);
        throw error;
      });
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    onTimeout: "pause" | "kill",
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const provisionLogger = createProvisionLogger(this.name, config.workspaceId);
    const sandbox = await provisionLogger.step("create-sandbox", () =>
      this.createSandbox(config, onTimeout),
    );
    const repoDir = this.getRepoDir(config);

    await provisionLogger.step("clone-repository", () =>
      this.cloneRepository(sandbox, config, repoDir),
    );
    await provisionLogger.step("write-opencode-files", () =>
      this.writeOpencodeFiles(sandbox, config),
    );
    await provisionLogger.step("configure-ssh-runtime", () =>
      this.configureSshRuntime(sandbox, config),
    );
    await provisionLogger.step("start-opencode-server", () =>
      this.startOpencodeServer(sandbox, repoDir),
    );

    const trafficAccessToken = await provisionLogger.step("resolve-traffic-access-token", () =>
      this.getTrafficAccessToken(sandbox, "workspace traffic"),
    );
    const host = sandbox.getHost(OPENCODE_PORT);
    const startedAt = new Date(
      (
        await provisionLogger.step("fetch-sandbox-info", () => sandbox.getInfo())
      ).startedAt,
    );

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: sandbox.sandboxId,
      upstreamUrl: `https://${host}`,
      upstreamAccess: getTrafficAccessHeaders(trafficAccessToken),
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt: startedAt,
    };

    provisionLogger.log(
      `workspace-ready persistent=${persistent} sshEnabled=${this.isSshEnabledWorkspace(config)}`,
    );

    if (!persistent) {
      return workspaceInfo;
    }

    return {
      ...workspaceInfo,
      externalVolumeId: sandbox.sandboxId,
      volumeCreatedAt: startedAt,
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
    const sandbox = await this.connectSandbox(externalId);

    await sandbox.pause({ apiKey: await this.getApiKey() }).catch((error: Error) => {
      console.error("E2B Sandbox Error (Sandbox.pause)", error.message);
      throw new Error(`E2B Sandbox Error (Sandbox.pause): ${error.message}`);
    });
  }

  async restartWorkspace(
    externalId: string,
    _regionIdentifier: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    await this.connectSandbox(externalId).catch((error: Error) => {
      console.error("E2B Sandbox Error while restarting (Sandbox.connect)", error.message);
      throw new Error(`E2B Sandbox Error while restarting (Sandbox.connect): ${error.message}`);
    });
  }

  async terminateWorkspace(externalServiceId: string, _externalVolumeId?: string): Promise<void> {
    const sandbox = await this.connectSandbox(externalServiceId);

    await sandbox.kill().catch((error: Error) => {
      console.error("E2B Sandbox Error (Sandbox.kill)", error.message);
      throw new Error(`E2B Sandbox Error (Sandbox.kill): ${error.message}`);
    });
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const sandbox = await this.connectSandbox(externalId);
      const info = (await sandbox.getInfo()) as { state?: string };

      if (info.state === "paused") {
        return { status: "stopped" };
      }

      if (info.state === "running") {
        return { status: "running" };
      }

      return { status: "terminated" };
    } catch (error: unknown) {
      console.error(
        "E2B Sandbox Error (getStatus)",
        error instanceof Error ? error.message : error,
      );
      return { status: "terminated" };
    }
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const sandbox = await this.connectSandbox(externalServiceId);

    return {
      domain: `https://${sandbox.getHost(port)}`,
      upstreamAccess: sandbox.trafficAccessToken
        ? getTrafficAccessHeaders(sandbox.trafficAccessToken)
        : undefined,
    };
  }

  async getWorkspaceEditorAccess(
    config: WorkspaceEditorAccessConfig,
  ): Promise<WorkspaceEditorAccess> {
    const sandbox = await this.connectSandbox(config.externalServiceId);
    const trafficAccessToken = await this.getTrafficAccessToken(sandbox, "SSH access");
    const bridgeHost = config.existingConnection?.host ?? (await this.waitForSshBridge(sandbox));
    const hostAlias = buildHostAlias(config.subdomain);
    const proxyCommand =
      `websocat --binary -B 65536 -H='e2b-traffic-access-token: ${trafficAccessToken}' - wss://${bridgeHost}`;

    return {
      providerName: this.name,
      transportKind: "proxycommand-ssh",
      hostAlias,
      host: config.externalServiceId,
      port: 22,
      user: SSH_USER,
      sshConnectionString: buildSshConnectionString({
        host: config.externalServiceId,
        port: 22,
        user: SSH_USER,
      }),
      sshCommand: buildSshCommand({
        host: config.externalServiceId,
        port: 22,
        user: SSH_USER,
        proxyCommand,
      }),
      sshConfigSnippet: buildStandardSshConfigSnippet({
        hostAlias,
        host: config.externalServiceId,
        port: 22,
        user: SSH_USER,
        proxyCommand,
      }),
      projectPathHint: this.getProjectPathHint(config.projectPathHint),
      requiredLocalBinaries: [...SSH_REQUIRED_BINARIES],
      connection: {
        transportKind: "proxycommand-ssh",
        host: bridgeHost,
        port: 443,
      },
      notes: [...SSH_NOTES],
    };
  }

  async revokeWorkspaceEditorAccess(_config: WorkspaceEditorAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // E2B does not expose a separate delete step for public port hosts.
  }
}

export const e2bProvider = new E2BProvider();
