import env from "@gitterm/env/server";
import { Daytona, Image } from "@daytonaio/sdk";
import type { DaytonaImageProviderMetadata } from "@gitterm/db/schema/cloud";
import path from "path";
import { getProviderConfigService } from "../../service/config/provider-config";
import { getEncryptionService } from "../../service/encryption";
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
import { DAYTONA_DEFAULT_RESOURCES } from "./resources";
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
import type { DaytonaConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const AGENT_SERVER_SESSION_ID = "gitterm-agent-server";
const REPO_NAME_LABEL = "gitterm_repo_name";
const WORKSPACE_ID_LABEL = "gitterm_workspace_id";
const PERSISTENT_LABEL = "gitterm_persistent";
// Serve command/port live on the sandbox as labels so restarts (which have no
// provisioning spec) can relaunch whichever agent the workspace runs.
const AGENT_SERVE_COMMAND_LABEL = "gitterm_agent_serve_command";
const AGENT_SERVE_PORT_LABEL = "gitterm_agent_serve_port";
const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;
const DAYTONA_WORKSPACE_DIR = "/workspace";
const SSH_ACCESS_TTL_MINUTES = 120;
const SSH_ACCESS_REUSE_BUFFER_MS = 5 * 60 * 1000;

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
  return DAYTONA_WORKSPACE_DIR;
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

  async getConfig(): Promise<DaytonaConfig> {
    const dbConfig = await getProviderConfigService().getProviderConfigForUse("daytona");
    if (!dbConfig) {
      console.error("Daytona provider is not configured.");
      throw new Error(
        "Daytona provider is not configured. Please configure it in the admin panel.",
      );
    }

    return dbConfig as DaytonaConfig;
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

  private getWorkspaceLabels(
    config: WorkspaceConfig,
    spec: WorkspaceProvisioningSpec | null,
    persistent: boolean,
  ): Record<string, string> {
    const labels: Record<string, string> = {
      [WORKSPACE_ID_LABEL]: config.workspaceId,
      [PERSISTENT_LABEL]: String(persistent),
    };

    const repoName = spec?.repo?.name;
    if (repoName) {
      labels[REPO_NAME_LABEL] = repoName;
    }

    const serve = spec?.agent.serve;
    if (serve) {
      labels[AGENT_SERVE_COMMAND_LABEL] = serve.command;
      labels[AGENT_SERVE_PORT_LABEL] = String(serve.port);
    }

    return labels;
  }

  private isEditorAccessWorkspace(spec: WorkspaceProvisioningSpec | null): boolean {
    return spec?.editorAccessEnabled === true;
  }

  private getTargetRegion(_config: WorkspaceConfig, providerConfig: DaytonaConfig): string {
    // A Daytona API key is bound to a single region, so user-supplied region
    // choice is ignored. We always use the region configured by the admin.
    return providerConfig.defaultTargetRegion;
  }

  private getImageCreateParams(
    config: WorkspaceConfig,
    editorAccess: boolean,
  ): {
    imageRef: string;
    resources: { cpu: number; memory: number; disk?: number };
  } {
    const metadata = config.imageProviderMetadata?.daytona as
      | DaytonaImageProviderMetadata
      | undefined;

    const imageRef =
      metadata?.image ??
      (config.imageId.includes(":") ? config.imageId : `${config.imageId}:latest`);

    const defaults = editorAccess
      ? DAYTONA_DEFAULT_RESOURCES.editor
      : DAYTONA_DEFAULT_RESOURCES.server;
    const override = editorAccess ? metadata?.editorResources : metadata?.resources;

    return {
      imageRef,
      resources: {
        cpu: override?.cpu ?? defaults.cpu,
        memory: override?.memory ?? defaults.memory,
        ...(override?.disk != null ? { disk: override.disk } : {}),
      },
    };
  }

  private getProjectPathHint(pathHint: string): string {
    return pathHint.replace(/^\/workspace/, DAYTONA_WORKSPACE_DIR);
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

  private async startAgentServer(
    sandbox: DaytonaSandbox,
    repoName: string | undefined,
    serve: { command: string; port: number },
  ): Promise<void> {
    const repoDir = getRepoDir(repoName);

    await sandbox.process.createSession(AGENT_SERVER_SESSION_ID).catch((error) => {
      console.error("Daytona Sandbox Error (createSession)", error);
      throw new Error(
        `Daytona Sandbox Error (createSession): ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    await sandbox.process
      .executeSessionCommand(AGENT_SERVER_SESSION_ID, {
        command: `cd "${repoDir}"`,
      })
      .catch((error) => {
        console.error("Daytona Sandbox Error (cd repoDir)", error);
        throw new Error(
          `Daytona Sandbox Error (cd repoDir): ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    await sandbox.process
      .executeSessionCommand(AGENT_SERVER_SESSION_ID, {
        command: `${serve.command} > /tmp/agent-server.log 2>&1`,
        runAsync: true,
      })
      .catch((error) => {
        console.error("Daytona Sandbox Error (agent serve)", error);
        throw new Error(
          `Daytona Sandbox Error (agent serve): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /** Launch the agent's post-start command detached; failures are non-fatal. */
  private async runPostStartCommand(
    sandbox: DaytonaSandbox,
    spec: WorkspaceProvisioningSpec | null,
  ): Promise<void> {
    const command = spec?.agent.serve?.postStartCommand;
    if (!command) {
      return;
    }

    await sandbox.process
      .executeSessionCommand(AGENT_SERVER_SESSION_ID, {
        command: `(${command}) > /tmp/agent-post-start.log 2>&1`,
        runAsync: true,
      })
      .catch((error) => {
        console.error("Daytona Sandbox Error (post-start command)", error);
      });
  }

  /** Run the agent's access-credential command before starting its server. */
  private async captureAccessCredential(
    sandbox: DaytonaSandbox,
    spec: WorkspaceProvisioningSpec | null,
    repoName: string | undefined,
  ): Promise<string | undefined> {
    const command = spec?.agent.serve?.accessCredentialCommand;
    if (!command) {
      return undefined;
    }

    const repoDir = getRepoDir(repoName);

    try {
      const response = await sandbox.process.executeCommand(`cd "${repoDir}" && ${command}`);
      const credential = response.result?.trim();
      if (response.exitCode === 0 && credential) {
        return credential;
      }
    } catch {
      // Credential capture is non-fatal; the workspace can still start.
    }

    console.error("Daytona Sandbox Error (capture access credential): command never succeeded");
    return undefined;
  }

  private getRepoNameFromSandbox(sandbox: DaytonaSandbox): string | undefined {
    const repoName = sandbox.labels?.[REPO_NAME_LABEL];
    return repoName && repoName.length > 0 ? repoName : undefined;
  }

  /** Serve command/port for restarts, from labels (legacy sandboxes: OpenCode). */
  private getServeSpecFromSandbox(sandbox: DaytonaSandbox): { command: string; port: number } {
    const command = sandbox.labels?.[AGENT_SERVE_COMMAND_LABEL];
    const port = Number(sandbox.labels?.[AGENT_SERVE_PORT_LABEL]);

    if (command && Number.isFinite(port) && port > 0) {
      return { command, port };
    }

    return DEFAULT_AGENT_SERVE;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const provisionLogger = createProvisionLogger(this.name, config.workspaceId);
    const providerConfig = await this.getConfig();
    const targetRegion = this.getTargetRegion(config, providerConfig);
    const spec = resolveProvisioningSpec(config);
    const editorAccess = this.isEditorAccessWorkspace(spec);
    const { imageRef, resources } = this.getImageCreateParams(config, editorAccess);
    const daytona = await this.createClient(targetRegion);
    const repoName = spec?.repo?.name;
    const repoDir = getRepoDir(repoName);

    const image = Image.base(imageRef).entrypoint(["sleep", "infinity"]);

    const sandbox = await provisionLogger.step(
      `create-sandbox image=${imageRef} cpu=${resources.cpu} mem=${resources.memory}`,
      () =>
        daytona.create(
          {
            image,
            resources,
            labels: this.getWorkspaceLabels(config, spec, persistent),
            envVars: {
              ...spec?.agent.env,
              AGENT_RUNTIME_UPGRADE: "1",
            },
          },
          {
            timeout: 300,
            onSnapshotCreateLogs: (chunk) => {
              process.stdout.write(chunk);
            },
          },
        ),
    );

    if (spec?.repo) {
      const parsedGitRepoUrl = spec.repo.url.endsWith(".git")
        ? spec.repo.url
        : `${spec.repo.url}.git`;

      const username = spec.repo.authToken ? spec.repo.authUsername : undefined;
      const password = spec.repo.authToken;
      const repoBranch = spec.repo.checkoutRef || spec.repo.branch;

      await provisionLogger.step("clone-repository", () =>
        sandbox.git
          .clone(parsedGitRepoUrl, repoDir, repoBranch, undefined, username, password)
          .catch(async (err) => {
            await sandbox.delete().catch(() => undefined);
            console.error("Daytona killed sandbox because of err:", err);
            throw err;
          }),
      );

      if (spec.repo.baseCommit) {
        await provisionLogger.step("checkout-base-commit", () =>
          this.executeCommand(
            sandbox,
            `git -C ${repoDir} fetch --depth 1 origin ${spec.repo!.baseCommit} && git -C ${repoDir} cat-file -e ${spec.repo!.baseCommit}^{commit} && git -C ${repoDir} checkout --detach ${spec.repo!.baseCommit} && test "$(git -C ${repoDir} rev-parse HEAD)" = "${spec.repo!.baseCommit}"`,
            true,
          ).catch(async (err) => {
            await sandbox.delete().catch(() => undefined);
            console.error("Daytona killed sandbox because of err:", err);
            throw err;
          }),
        );
      }
    }

    if (spec && spec.agent.files.length > 0) {
      await provisionLogger.step("write-agent-files", async () => {
        for (const file of spec.agent.files) {
          const dir = file.path.substring(0, file.path.lastIndexOf("/"));
          if (dir) {
            await this.executeCommand(sandbox, `mkdir -p ${dir}`, true);
          }
          await this.executeCommand(
            sandbox,
            `echo "${file.contentBase64}" | base64 -d > ${file.path}`,
            true,
          );
        }
      });
    }

    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;

    const accessCredential = await provisionLogger.step("capture-access-credential", () =>
      this.captureAccessCredential(sandbox, spec, repoName),
    );

    await provisionLogger.step("start-agent-server", () =>
      this.startAgentServer(sandbox, repoName, serve),
    );
    await provisionLogger.step("run-post-start-command", () =>
      this.runPostStartCommand(sandbox, spec),
    );

    const previewUrlData = await provisionLogger.step("create-preview-link", () =>
      sandbox.getPreviewLink(serve.port),
    );
    const serviceCreatedAt = toDate(sandbox.createdAt);

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: sandbox.id,
      upstreamUrl: previewUrlData.url,
      upstreamAccess: previewUrlData.token
        ? getTrafficAccessHeaders(previewUrlData.token)
        : undefined,
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt,
      accessCredential,
    };

    provisionLogger.log(
      `workspace-ready persistent=${persistent} editorAccess=${editorAccess} region=${targetRegion} image=${imageRef}`,
    );

    if (!persistent) {
      return workspaceInfo;
    }

    return {
      ...workspaceInfo,
      externalVolumeId: sandbox.id,
      volumeCreatedAt: serviceCreatedAt,
    };
  }

  async execCommand(
    externalId: string,
    command: string,
  ): Promise<{ exitCode: number; stdout: string }> {
    const daytona = await this.createClient();
    const sandbox = await daytona.get(externalId);
    const response = await sandbox.process.executeCommand(command);
    return { exitCode: response.exitCode, stdout: response.result ?? "" };
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return (await this.provisionWorkspace(config, false)) as WorkspaceInfo;
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    return (await this.provisionWorkspace(config, true)) as PersistentWorkspaceInfo;
  }

  async pauseWorkspace(
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

  async resumeWorkspace(
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

    await this.startAgentServer(
      sandbox,
      this.getRepoNameFromSandbox(sandbox),
      this.getServeSpecFromSandbox(sandbox),
    );
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
          return { status: "paused", lastActiveAt };
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
  ): Promise<{
    domain: string;
    externalPortDomainId?: string;
    upstreamAccess?: UpstreamAccess;
  }> {
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

  async getWorkspaceSSHAccess(config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    const existingToken = this.decryptRevocationToken(config.existingConnection?.revocationToken);
    const existingExpiresAt = config.existingConnection?.expiresAt;
    if (
      existingToken &&
      existingExpiresAt &&
      new Date(existingExpiresAt).getTime() > Date.now() + SSH_ACCESS_REUSE_BUFFER_MS
    ) {
      return this.buildWorkspaceSSHAccess(config, existingToken, existingExpiresAt);
    }

    // Single-region key: always use the admin-configured default region.
    const daytona = await this.createClient();
    const sandbox = await daytona.get(config.externalServiceId);

    if (existingToken) {
      await sandbox.revokeSshAccess(existingToken).catch(() => undefined);
    }

    const sshToken = await sandbox.createSshAccess(SSH_ACCESS_TTL_MINUTES);
    const expiresAt = new Date(Date.now() + SSH_ACCESS_TTL_MINUTES * 60 * 1000).toISOString();

    return this.buildWorkspaceSSHAccess(config, sshToken.token, expiresAt);
  }

  private buildWorkspaceSSHAccess(
    config: WorkspaceSSHAccessConfig,
    token: string,
    expiresAt: string,
  ): WorkspaceSSHAccess {
    const host = "ssh.app.daytona.io";
    // Daytona's SSH gateway authenticates by passing the access token as the
    // SSH username (i.e. `<token>@ssh.app.daytona.io`), so the token IS the user.
    const user = token;
    const port = 22;
    const hostAlias = buildHostAlias(config.subdomain);

    return {
      providerName: this.name,
      transportKind: "direct-ssh",
      hostAlias,
      host,
      port,
      user,
      sshConnectionString: buildSshConnectionString({ host, port, user }),
      sshCommand: buildSshCommand({ host, port, user }),
      sshConfigSnippet: buildStandardSshConfigSnippet({
        hostAlias,
        host,
        port,
        user,
      }),
      projectPathHint: this.getProjectPathHint(config.projectPathHint),
      expiresAt,
      connection: {
        transportKind: "direct-ssh",
        host,
        port,
        // The Daytona SSH token doubles as the SSH user and is required to
        // revoke access later, so it is stored encrypted at rest.
        revocationToken: getEncryptionService().encrypt(token),
        expiresAt,
      },
      notes: [
        "This short-lived SSH token expires after about two hours.",
        "Use the generated host alias in VS Code Remote SSH, Cursor, Windsurf, or NeoVim.",
      ],
    };
  }

  private decryptRevocationToken(token?: string): string | undefined {
    if (!token) {
      return undefined;
    }
    try {
      return getEncryptionService().decrypt(token);
    } catch (error) {
      console.warn("Daytona: failed to decrypt stored SSH token", error);
      return undefined;
    }
  }

  async revokeWorkspaceSSHAccess(config: WorkspaceSSHAccessCleanupConfig): Promise<void> {
    const token = this.decryptRevocationToken(config.connection.revocationToken);
    if (!token) {
      return;
    }

    // Single-region key: always use the admin-configured default region.
    const daytona = await this.createClient();
    const sandbox = await daytona.get(config.externalServiceId);
    await sandbox.revokeSshAccess(token);
  }

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // Daytona preview links are generated on demand and do not need explicit cleanup here.
  }
}

export const daytonaProvider = new DaytonaProvider();
