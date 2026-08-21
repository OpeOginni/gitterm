import { Sandbox } from "@vercel/sandbox";
import env from "@gitterm/env/server";
import type { VercelImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
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
import type { VercelConfig } from "./types";

export type { VercelConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/vercel/sandbox";
const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;
const WORKSPACE_ID_TAG = "gitterm_workspace";
const REPO_NAME_TAG = "gitterm_repo";
const AGENT_COMMAND_TAG = "gitterm_command";
const AGENT_PORT_TAG = "gitterm_port";
const CONTAINER_PROVISIONING_ENV_KEYS = new Set([
  "AGENT_FILES_BASE64",
  "GITHUB_APP_TOKEN",
  "GITHUB_APP_TOKEN_EXPIRY",
  "REPO_BASE_COMMIT",
  "REPO_BRANCH",
  "REPO_CHECKOUT_REF",
  "REPO_NAME",
  "REPO_OWNER",
  "REPO_URL",
  "USER_GITHUB_USERNAME",
  "USER_SSH_PUBLIC_KEY",
  "WORKSPACE_SETUP_COMMAND_BASE64",
  "WORKSPACE_TOOLING_MANIFEST_BASE64",
]);

type VercelSandbox = Awaited<ReturnType<typeof Sandbox.get>>;

export class VercelProvider implements ComputeProvider {
  readonly name = "vercel";

  async getConfig(): Promise<VercelConfig> {
    const config = await getProviderConfigService().getProviderConfigForUse(this.name);
    if (!config) {
      throw new Error("Vercel provider is not configured. Please configure it in the admin panel.");
    }
    return config as VercelConfig;
  }

  private async getCredentials(): Promise<VercelConfig> {
    const config = await this.getConfig();
    if (!config.apiToken || !config.teamId || !config.projectId) {
      throw new Error("Vercel API token, team ID, and project ID must be configured.");
    }
    return config;
  }

  private async getSdkCredentials() {
    const credentials = await this.getCredentials();
    return {
      token: credentials.apiToken,
      teamId: credentials.teamId,
      projectId: credentials.projectId,
    };
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

  private getSandboxName(workspaceId: string): string {
    return `gitterm-${workspaceId}`;
  }

  private getRepoDir(spec: WorkspaceProvisioningSpec | null): string {
    return `${WORKSPACE_DIR}/${spec?.repo?.name ?? "workspace"}`;
  }

  private getImageMetadata(config: WorkspaceConfig): VercelImageProviderMetadata {
    const metadata = config.imageProviderMetadata?.vercel as
      | VercelImageProviderMetadata
      | undefined;
    if (!metadata?.image && !metadata?.runtime) {
      throw new Error(
        `Image ${config.imageId} has no Vercel image or runtime metadata configured.`,
      );
    }
    return metadata;
  }

  private getEnvironment(config: WorkspaceConfig, spec: WorkspaceProvisioningSpec | null) {
    return Object.fromEntries(
      Object.entries({ ...config.environmentVariables, ...spec?.agent.env }).filter(
        ([key, value]) => value !== undefined && !CONTAINER_PROVISIONING_ENV_KEYS.has(key),
      ),
    ) as Record<string, string>;
  }

  private getServeSpec(sandbox: VercelSandbox): { command: string; port: number } {
    const command = sandbox.tags?.[AGENT_COMMAND_TAG];
    const port = Number(sandbox.tags?.[AGENT_PORT_TAG]);
    return command && Number.isFinite(port) && port > 0 ? { command, port } : DEFAULT_AGENT_SERVE;
  }

  private getRepoDirFromSandbox(sandbox: VercelSandbox): string {
    const repoName = sandbox.tags?.[REPO_NAME_TAG];
    return `${WORKSPACE_DIR}/${repoName || "workspace"}`;
  }

  private async startAgentServer(
    sandbox: VercelSandbox,
    repoDir: string,
    serve: { command: string; port: number },
  ): Promise<void> {
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `exec ${serve.command} > /tmp/agent-server.log 2>&1`],
      cwd: repoDir,
      detached: true,
    });
  }

  private async setupAgent(sandbox: VercelSandbox, commands: string[] | undefined): Promise<void> {
    for (const command of commands ?? []) {
      await sandbox.runCommand({ cmd: "bash", args: ["-lc", command] });
    }
  }

  private async writeAgentFiles(sandbox: VercelSandbox, spec: WorkspaceProvisioningSpec | null) {
    const homeResult = await sandbox.runCommand("printenv", ["HOME"]);
    const homeDirectory = (await homeResult.stdout()).trim() || "/home/vercel-sandbox";
    for (const file of spec?.agent.files ?? []) {
      const target = file.path.startsWith("~/")
        ? `${homeDirectory}/${file.path.slice(2)}`
        : file.path;
      const directory = target.substring(0, target.lastIndexOf("/"));
      if (directory) {
        await sandbox.runCommand("mkdir", ["-p", directory]);
      }
      await sandbox.writeFiles([
        { path: target, content: Buffer.from(file.contentBase64, "base64") },
      ]);
    }
  }

  private async captureAccessCredential(
    sandbox: VercelSandbox,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ): Promise<string | undefined> {
    const command = spec?.agent.serve?.accessCredentialCommand;
    if (!command) return undefined;

    try {
      const result = await sandbox.runCommand({
        cmd: "bash",
        args: ["-lc", command],
        cwd: repoDir,
      });
      const credential = (await result.stdout()).trim();
      if (result.exitCode === 0 && credential) return credential;
    } catch {
      // Credential capture is non-fatal; the workspace can still start.
    }

    console.error("Vercel Sandbox Error (capture access credential): command never succeeded");
    return undefined;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const logger = createProvisionLogger(this.name, config.workspaceId);
    const credentials = await this.getSdkCredentials();
    const spec = resolveProvisioningSpec(config);
    const metadata = this.getImageMetadata(config);
    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;
    const repoDir = this.getRepoDir(spec);
    let accessCredential: string | undefined;
    const sandbox = await logger.step("create-sandbox", () =>
      Sandbox.create({
        ...credentials,
        name: this.getSandboxName(config.workspaceId),
        // Vercel only restores the filesystem across stop/resume when the
        // sandbox is persistent; without it a restarted workspace comes back
        // with a fresh FS (no repo, no installed agent) and never gets healthy.
        // Every gitterm workspace supports pause/restart, so always opt in.
        persistent: true,
        keepLastSnapshots: { count: 1 },
        ports: [serve.port],
        env: this.getEnvironment(config, spec),
        tags: {
          [WORKSPACE_ID_TAG]: config.workspaceId,
          [REPO_NAME_TAG]: spec?.repo?.name ?? "workspace",
          [AGENT_COMMAND_TAG]: serve.command,
          [AGENT_PORT_TAG]: String(serve.port),
        },
        ...(metadata.image ? { image: metadata.image } : { runtime: metadata.runtime }),
        ...(metadata.vcpus ? { resources: { vcpus: metadata.vcpus } } : {}),
      }),
    );

    try {
      await logger.step("create-workspace-directory", () =>
        sandbox.runCommand("mkdir", ["-p", repoDir]),
      );
      await logger.step("setup-agent", () => this.setupAgent(sandbox, metadata.setupCommands));
      if (spec?.repo) {
        const repo = spec.repo;
        const repositoryUrl = repo.url.endsWith(".git") ? repo.url : `${repo.url}.git`;
        const askPassPath = "/tmp/gitterm-git-askpass";
        if (repo.authToken) {
          await sandbox.writeFiles([
            {
              path: askPassPath,
              mode: 0o700,
              content: `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' "$GITTERM_GIT_USERNAME" ;;
  *) printf '%s\\n' "$GITTERM_GIT_TOKEN" ;;
esac
`,
            },
          ]);
        }
        try {
          await logger.step("clone-repository", () =>
            sandbox.runCommand({
              cmd: "git",
              args: [
                "clone",
                ...(repo.checkoutRef || repo.branch
                  ? ["--branch", repo.checkoutRef || repo.branch!]
                  : []),
                repositoryUrl,
                repoDir,
              ],
              env: repo.authToken
                ? {
                    GIT_ASKPASS: askPassPath,
                    GIT_TERMINAL_PROMPT: "0",
                    GITTERM_GIT_USERNAME: repo.authUsername ?? "x-access-token",
                    GITTERM_GIT_TOKEN: repo.authToken,
                  }
                : undefined,
            }),
          );
        } finally {
          if (repo.authToken) {
            await sandbox.runCommand("rm", ["-f", askPassPath]).catch(() => undefined);
          }
        }
        if (repo.baseCommit) {
          await logger.step("checkout-base-commit", () =>
            sandbox.runCommand({
              cmd: "bash",
              args: [
                "-lc",
                `git -C "${repoDir}" fetch --depth 1 origin ${repo.baseCommit} && git -C "${repoDir}" checkout --detach ${repo.baseCommit}`,
              ],
            }),
          );
        }
      }
      await logger.step("write-agent-files", () => this.writeAgentFiles(sandbox, spec));
      accessCredential = await logger.step("capture-access-credential", () =>
        this.captureAccessCredential(sandbox, spec, repoDir),
      );
      await logger.step("start-agent-server", () => this.startAgentServer(sandbox, repoDir, serve));
      if (spec?.agent.serve?.postStartCommand) {
        await logger.step("run-post-start-command", () =>
          sandbox.runCommand({
            cmd: "bash",
            args: ["-lc", spec.agent.serve!.postStartCommand!],
            cwd: repoDir,
            detached: true,
          }),
        );
      }
    } catch (error) {
      await sandbox.delete().catch(() => undefined);
      throw error;
    }

    const workspaceInfo: WorkspaceInfo = {
      externalServiceId: sandbox.name,
      upstreamUrl: sandbox.domain(serve.port),
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt: sandbox.createdAt,
      accessCredential,
    };
    if (!persistent) return workspaceInfo;
    return { ...workspaceInfo, externalVolumeId: sandbox.name, volumeCreatedAt: sandbox.createdAt };
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
    const credentials = await this.getSdkCredentials();
    const sandbox = await Sandbox.get({ name: externalId, ...credentials });
    const result = await sandbox.runCommand({ cmd: "bash", args: ["-lc", command] });
    return { exitCode: result.exitCode, stdout: await result.stdout() };
  }

  async pauseWorkspace(externalId: string): Promise<void> {
    const credentials = await this.getSdkCredentials();
    const sandbox = await Sandbox.get({ name: externalId, resume: false, ...credentials });
    if (sandbox.status !== "stopped") await sandbox.stop();
  }

  async resumeWorkspace(externalId: string): Promise<{ upstreamUrl: string }> {
    const credentials = await this.getSdkCredentials();
    const sandbox = await Sandbox.get({
      name: externalId,
      ...credentials,
      // The API only resumes when the flag is sent explicitly; without it a
      // stopped sandbox is returned as-is and onResume never fires.
      resume: true,
      onResume: async (resumed) =>
        this.startAgentServer(
          resumed,
          this.getRepoDirFromSandbox(resumed),
          this.getServeSpec(resumed),
        ),
    });
    // Route subdomains are session-scoped: a resume mints a new session with
    // new routes, so the upstream URL captured at creation no longer resolves.
    return { upstreamUrl: sandbox.domain(this.getServeSpec(sandbox).port) };
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    const credentials = await this.getSdkCredentials();
    const sandbox = await Sandbox.get({ name: externalId, resume: false, ...credentials });
    await sandbox.delete();
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const credentials = await this.getSdkCredentials();
      const sandbox = await Sandbox.get({ name: externalId, resume: false, ...credentials });
      const lastActiveAt = sandbox.statusUpdatedAt ?? sandbox.updatedAt;
      if (sandbox.status === "running") return { status: "running", lastActiveAt };
      if (["pending", "stopping", "snapshotting"].includes(sandbox.status))
        return { status: "pending", lastActiveAt };
      if (sandbox.status === "stopped") return { status: "paused", lastActiveAt };
      return { status: "terminated", lastActiveAt };
    } catch {
      return { status: "terminated" };
    }
  }

  async keepAliveWorkspace(externalId: string, timeoutMs: number): Promise<void> {
    const credentials = await this.getSdkCredentials();
    const sandbox = await Sandbox.get({ name: externalId, ...credentials });
    await sandbox.update({ timeout: timeoutMs });
  }

  async createOrGetExposedPortDomain(
    externalId: string,
    port: number,
  ): Promise<{ domain: string }> {
    const credentials = await this.getSdkCredentials();
    const sandbox = await Sandbox.get({ name: externalId, ...credentials });
    if (!sandbox.routes.some((route) => route.port === port)) {
      await sandbox.update({ ports: [...sandbox.routes.map((route) => route.port), port] });
    }
    return { domain: sandbox.domain(port) };
  }

  async getWorkspaceSSHAccess(_config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    throw new Error("Vercel Sandbox does not support SSH editor access.");
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {}
}

export const vercelProvider = new VercelProvider();
