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
  WorkspaceProvisioningSpec,
  WorkspaceStatusResult,
} from "../compute";
import { resolveProvisioningSpec } from "../provisioning-spec";
import {
  buildHostAlias,
  buildSshCommand,
  buildSshConnectionString,
  buildStandardSshConfigSnippet,
  type WorkspaceSSHAccess,
  type WorkspaceSSHAccessCleanupConfig,
  type WorkspaceSSHAccessConfig,
} from "../ssh-access";
import { createProvisionLogger } from "../provision-logger";
import type { E2BConfig } from "./types";
import { getWorkspaceIdleTimeoutMs } from "../../service/workspace-timeouts";

export type { E2BConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/home/user/workspace";
/** Used when the spec carries no agent serve port (legacy OpenCode default). */
const DEFAULT_AGENT_PORT = 4096;
const SSH_BRIDGE_PORT = 8081;
const SSH_USER = "user";
const SSH_REQUIRED_BINARIES = ["websocat"] as const;
const SSH_NOTES = [
  "Uses your saved SSH public key; keep the matching private key available locally.",
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

  private getRepoDir(spec: WorkspaceProvisioningSpec | null): string {
    const repoName = spec?.repo?.name ?? "workspace";
    return `${WORKSPACE_DIR}/${repoName}`;
  }

  private getProjectPathHint(pathHint: string): string {
    return pathHint.replace(/^\/workspace/, WORKSPACE_DIR);
  }

  private isSshEnabledWorkspace(spec: WorkspaceProvisioningSpec | null): boolean {
    return spec?.workspaceProfile === "ssh-enabled";
  }

  private getTemplateId(config: WorkspaceConfig, sshEnabled: boolean): string {
    const e2bMetadata = config.imageProviderMetadata?.e2b;
    const templateId = sshEnabled
      ? (e2bMetadata?.sshTemplateId ?? e2bMetadata?.templateId)
      : e2bMetadata?.templateId;

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
    sshEnabled: boolean,
  ): Promise<E2BSandbox> {
    const timeoutMs = await getWorkspaceIdleTimeoutMs(config.userId);

    return Sandbox.create(this.getTemplateId(config, sshEnabled), {
      apiKey: await this.getApiKey(),
      timeoutMs,
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

  async execCommand(
    externalId: string,
    command: string,
  ): Promise<{ exitCode: number; stdout: string }> {
    const sandbox = await this.connectSandbox(externalId);
    const result = await sandbox.commands.run(command);
    return { exitCode: result.exitCode, stdout: result.stdout };
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
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ): Promise<void> {
    await this.runCommand(sandbox, `mkdir -p ${WORKSPACE_DIR}`, "mkdir workspace");

    if (!spec?.repo) {
      await this.runCommand(sandbox, `mkdir -p ${repoDir}`, "mkdir empty repo dir");
      return;
    }

    const cloneBranch = spec.repo.checkoutRef || spec.repo.branch;
    await sandbox.git
      .clone(this.getRepositoryUrl(spec.repo.url), {
        path: repoDir,
        username: spec.repo.authToken ? spec.repo.authUsername : undefined,
        password: spec.repo.authToken,
        branch: cloneBranch,
      })
      .catch(async (error) => {
        await sandbox.kill().catch(() => undefined);
        console.error("E2B Sandbox Error (git.clone)", error);
        throw error;
      });

    if (spec.repo.baseCommit) {
      await this.runCommand(
        sandbox,
        `git -C ${repoDir} fetch --depth 1 origin ${spec.repo.baseCommit} && git -C ${repoDir} cat-file -e ${spec.repo.baseCommit}^{commit} && git -C ${repoDir} checkout --detach ${spec.repo.baseCommit} && test "$(git -C ${repoDir} rev-parse HEAD)" = "${spec.repo.baseCommit}"`,
        "checkout base commit",
      );
    }
  }

  private async writeAgentFiles(
    sandbox: E2BSandbox,
    spec: WorkspaceProvisioningSpec | null,
  ): Promise<void> {
    for (const file of spec?.agent.files ?? []) {
      const dir = file.path.substring(0, file.path.lastIndexOf("/"));
      if (dir) {
        await this.runCommand(sandbox, `mkdir -p ${dir}`, `mkdir dir for ${file.path}`);
      }
      await this.runCommand(
        sandbox,
        `echo "${file.contentBase64}" | base64 -d > ${file.path}`,
        `write agent file ${file.path}`,
      );
    }
  }

  private toBase64(value: string): string {
    return Buffer.from(value).toString("base64");
  }

  private async configureSshRuntime(
    sandbox: E2BSandbox,
    spec: WorkspaceProvisioningSpec | null,
  ): Promise<void> {
    if (!this.isSshEnabledWorkspace(spec)) {
      return;
    }

    const publicKey = spec?.sshPublicKey;
    if (!publicKey) {
      throw new Error("E2B SSH workspace requires a user SSH public key.");
    }

    const keyB64 = this.toBase64(publicKey);

    await this.runCommand(
      sandbox,
      [
        `KEY="$(echo ${keyB64} | base64 -d)"`,
        "install -d -m 0700 /home/user/.ssh",
        "touch /home/user/.ssh/authorized_keys",
        "chmod 600 /home/user/.ssh/authorized_keys",
        `if ! grep -qxF "$KEY" /home/user/.ssh/authorized_keys 2>/dev/null; then printf '%s\\n' "$KEY" >> /home/user/.ssh/authorized_keys; fi`,
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

  private async getTrafficAccessToken(sandbox: E2BSandbox, errorContext: string): Promise<string> {
    const token = sandbox.trafficAccessToken;

    if (!token) {
      throw new Error(`E2B traffic access token missing for ${errorContext}.`);
    }

    return token;
  }

  private async startAgentServer(
    sandbox: E2BSandbox,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ): Promise<void> {
    const serve = spec?.agent.serve;
    if (!serve) {
      return;
    }

    const command = serve.command.replace(/'/g, `'"'"'`);

    await sandbox.commands
      .run(`nohup setsid bash -lc '${command}' > /tmp/agent-server.log 2>&1 </dev/null &`, {
        cwd: repoDir,
      })
      .catch(async (error) => {
        await sandbox.kill().catch(() => undefined);
        console.error("E2B Sandbox Error (start agent server)", error);
        throw error;
      });
  }

  /** Launch the agent's post-start command detached; failures are non-fatal. */
  private async runPostStartCommand(
    sandbox: E2BSandbox,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ): Promise<void> {
    const command = spec?.agent.serve?.postStartCommand;
    if (!command) {
      return;
    }

    const escaped = command.replace(/'/g, `'"'"'`);

    await sandbox.commands
      .run(`nohup setsid bash -lc '${escaped}' > /tmp/agent-post-start.log 2>&1 </dev/null &`, {
        cwd: repoDir,
      })
      .catch((error) => {
        console.error("E2B Sandbox Error (post-start command)", error);
      });
  }

  /** Run the agent's access-credential command before starting its server. */
  private async captureAccessCredential(
    sandbox: E2BSandbox,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ): Promise<string | undefined> {
    const command = spec?.agent.serve?.accessCredentialCommand;
    if (!command) {
      return undefined;
    }

    try {
      const result = await sandbox.commands.run(`cd ${repoDir} && ${command}`);
      const credential = result.stdout.trim();
      if (result.exitCode === 0 && credential) {
        return credential;
      }
    } catch {
      // Credential capture is non-fatal; the workspace can still start.
    }

    console.error("E2B Sandbox Error (capture access credential): command never succeeded");
    return undefined;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    onTimeout: "pause" | "kill",
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const provisionLogger = createProvisionLogger(this.name, config.workspaceId);
    const spec = resolveProvisioningSpec(config);
    const sandbox = await provisionLogger.step("create-sandbox", () =>
      this.createSandbox(config, onTimeout, this.isSshEnabledWorkspace(spec)),
    );
    const repoDir = this.getRepoDir(spec);

    await provisionLogger.step("clone-repository", () =>
      this.cloneRepository(sandbox, spec, repoDir),
    );
    await provisionLogger.step("write-agent-files", () => this.writeAgentFiles(sandbox, spec));
    await provisionLogger.step("configure-ssh-runtime", () =>
      this.configureSshRuntime(sandbox, spec),
    );
    const accessCredential = await provisionLogger.step("capture-access-credential", () =>
      this.captureAccessCredential(sandbox, spec, repoDir),
    );
    await provisionLogger.step("start-agent-server", () =>
      this.startAgentServer(sandbox, spec, repoDir),
    );
    await provisionLogger.step("run-post-start-command", () =>
      this.runPostStartCommand(sandbox, spec, repoDir),
    );

    const trafficAccessToken = await provisionLogger.step("resolve-traffic-access-token", () =>
      this.getTrafficAccessToken(sandbox, "workspace traffic"),
    );
    const host = sandbox.getHost(spec?.agent.serve?.port ?? DEFAULT_AGENT_PORT);
    const startedAt = new Date(
      (await provisionLogger.step("fetch-sandbox-info", () => sandbox.getInfo())).startedAt,
    );

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: sandbox.sandboxId,
      upstreamUrl: `https://${host}`,
      upstreamAccess: getTrafficAccessHeaders(trafficAccessToken),
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt: startedAt,
      accessCredential,
    };

    provisionLogger.log(
      `workspace-ready persistent=${persistent} sshEnabled=${this.isSshEnabledWorkspace(spec)}`,
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

  /**
   * Spawn an ephemeral, throwaway sandbox for the anonymous "try gitterm"
   * homepage flow. Identical to `createWorkspace` but uses `onTimeout: "kill"`
   * so the sandbox is destroyed (not paused) when the 10-minute lease
   * expires. There's no signed-in user to ever resume an anon workspace, so
   * pausing would just leave a zombie.
   */
  async createEphemeralAnonWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return (await this.provisionWorkspace(config, "kill", false)) as WorkspaceInfo;
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    return (await this.provisionWorkspace(config, "kill", true)) as PersistentWorkspaceInfo;
  }

  async pauseWorkspace(
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

  async resumeWorkspace(
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
    await Sandbox.kill(externalServiceId, { apiKey: await this.getApiKey() }).catch(
      (error: Error) => {
        console.error("E2B Sandbox Error (Sandbox.kill)", error.message);
        throw new Error(`E2B Sandbox Error (Sandbox.kill): ${error.message}`);
      },
    );
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const sandbox = await this.connectSandbox(externalId);
      const info = (await sandbox.getInfo()) as { state?: string };

      if (info.state === "paused") {
        return { status: "paused" };
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

  async keepAliveWorkspace(externalId: string, timeoutMs: number): Promise<void> {
    await Sandbox.setTimeout(externalId, timeoutMs, {
      apiKey: await this.getApiKey(),
    });
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{
    domain: string;
    externalPortDomainId?: string;
    upstreamAccess?: UpstreamAccess;
  }> {
    const sandbox = await this.connectSandbox(externalServiceId);

    return {
      domain: `https://${sandbox.getHost(port)}`,
      upstreamAccess: sandbox.trafficAccessToken
        ? getTrafficAccessHeaders(sandbox.trafficAccessToken)
        : undefined,
    };
  }

  async getWorkspaceSSHAccess(config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    const sandbox = await this.connectSandbox(config.externalServiceId);
    const trafficAccessToken = await this.getTrafficAccessToken(sandbox, "SSH access");
    const bridgeHost = config.existingConnection?.host ?? (await this.waitForSshBridge(sandbox));
    const hostAlias = buildHostAlias(config.subdomain);
    const proxyCommand = `websocat --binary -B 65536 -H='e2b-traffic-access-token: ${trafficAccessToken}' - wss://${bridgeHost}`;

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

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // E2B does not expose a separate delete step for public port hosts.
  }
}

export const e2bProvider = new E2BProvider();
