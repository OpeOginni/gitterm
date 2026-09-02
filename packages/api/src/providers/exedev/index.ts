import env from "@gitterm/env/server";
import type { ExeDevImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { getProviderConfigService } from "../../service/config/provider-config";
import { BeforeAgentSetupError } from "../compute";
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
import { inlineGitAuthCommands } from "../git-auth";
import {
  buildHostAlias,
  buildSshCommand,
  buildSshConnectionString,
  buildStandardSshConfigSnippet,
  type WorkspaceSSHAccess,
  type WorkspaceSSHAccessCleanupConfig,
  type WorkspaceSSHAccessConfig,
} from "../ssh-access";
import type { ExeDevConfig } from "./types";

export type { ExeDevConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/home/exedev";
const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;

type ExeDevHandle = {
  vmName: string;
  repoDir: string;
  serve: { command: string; port: number };
  sshPublicKey?: string;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function serializeHandle(handle: ExeDevHandle): string {
  return JSON.stringify(handle);
}

function parseHandle(value: string): ExeDevHandle {
  try {
    const handle = JSON.parse(value) as ExeDevHandle;
    if (!handle.vmName || !handle.repoDir || !handle.serve?.command || !handle.serve.port) {
      throw new Error("missing required fields");
    }
    return handle;
  } catch {
    throw new Error("Invalid exe.dev workspace handle.");
  }
}

function findToken(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.match(/exe[01]\.[A-Za-z0-9._-]+/)?.[0];
  }
  if (Array.isArray(value)) return value.map(findToken).find(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value).map(findToken).find(Boolean);
  }
  return undefined;
}

export class ExeDevProvider implements ComputeProvider {
  readonly name = "exedev";

  async getConfig(): Promise<ExeDevConfig> {
    const config = await getProviderConfigService().getProviderConfigForUse(this.name);
    if (!config) {
      throw new Error(
        "exe.dev provider is not configured. Please configure it in the admin panel.",
      );
    }
    return config as ExeDevConfig;
  }

  private async execute(command: string): Promise<unknown> {
    const { apiToken } = await this.getConfig();
    if (!apiToken) throw new Error("exe.dev API token is not configured.");
    const response = await fetch("https://exe.dev/exec", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "text/plain" },
      body: command,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`exe.dev command failed (${response.status}): ${text}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
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

  private getMetadata(config: WorkspaceConfig): ExeDevImageProviderMetadata {
    return (config.imageProviderMetadata?.exedev as ExeDevImageProviderMetadata | undefined) ?? {};
  }

  private getEnvironment(config: WorkspaceConfig, spec: WorkspaceProvisioningSpec | null) {
    return Object.fromEntries(
      Object.entries({ ...config.environmentVariables, ...spec?.agent.env }).filter(
        ([name, value]) => name !== "AGENT_FILES_BASE64" && value !== undefined,
      ),
    ) as Record<string, string>;
  }

  private async runVmCommand(handle: ExeDevHandle, command: string): Promise<unknown> {
    return this.execute(`ssh ${handle.vmName} -- bash -lc ${shellQuote(command)}`);
  }

  /**
   * The exe.dev exec API reports only its own HTTP status, not the remote
   * command's exit code, so the blocking setup phase appends a marker that
   * carries it back.
   */
  private async runBeforeAgentSetup(handle: ExeDevHandle, command: string): Promise<void> {
    const marker = "__GITTERM_BEFORE_AGENT_EXIT__";
    const output = await this.runVmCommand(
      handle,
      `cd ${shellQuote(handle.repoDir)} && ${command}; printf '\\n${marker}%s\\n' "$?"`,
    );
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const match = new RegExp(`${marker}(\\d+)`).exec(text);
    const exitCode = match ? Number(match[1]) : -1;
    if (exitCode !== 0) {
      throw new BeforeAgentSetupError(text.replace(new RegExp(`${marker}\\d+`), ""));
    }
  }

  private async startAgentServer(handle: ExeDevHandle): Promise<void> {
    await this.runVmCommand(
      handle,
      `cd ${shellQuote(handle.repoDir)} && nohup setsid bash -lc ${shellQuote(handle.serve.command)} > /tmp/agent-server.log 2>&1 </dev/null &`,
    );
  }

  private async writeAgentFiles(handle: ExeDevHandle, spec: WorkspaceProvisioningSpec | null) {
    for (const file of spec?.agent.files ?? []) {
      const path = file.relativeToRepo
        ? `${handle.repoDir}/${file.path}`
        : file.path.startsWith("~/")
          ? `${WORKSPACE_DIR}/${file.path.slice(2)}`
          : file.path;
      await this.runVmCommand(
        handle,
        `mkdir -p ${shellQuote(path.substring(0, path.lastIndexOf("/")))} && printf %s ${shellQuote(file.contentBase64)} | base64 -d > ${shellQuote(path)}${file.mode ? ` && chmod ${file.mode.toString(8)} ${shellQuote(path)}` : ""}`,
      );
    }
  }

  private async getVmAccessToken(vmName: string): Promise<string> {
    const result = await this.execute(
      `ssh-key generate-api-key --vm=${vmName} --label=gitterm --exp=never`,
    );
    const token = findToken(result);
    if (!token) throw new Error("exe.dev did not return a VM access token.");
    return token;
  }

  private async provisionWorkspace(
    config: WorkspaceConfig,
    persistent: boolean,
  ): Promise<WorkspaceInfo | PersistentWorkspaceInfo> {
    const spec = resolveProvisioningSpec(config);
    const logger = createProvisionLogger(
      this.name,
      config.workspaceId,
      spec?.repo?.authToken ? [spec.repo.authToken] : [],
    );
    const metadata = this.getMetadata(config);
    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;
    const vmName = `gitterm-${config.workspaceId.replaceAll("-", "").slice(0, 20)}`;
    const handle: ExeDevHandle = {
      vmName,
      repoDir: `${WORKSPACE_DIR}/${spec?.repo?.name ?? "workspace"}`,
      serve,
      sshPublicKey: spec?.sshPublicKey,
    };
    const environment = this.getEnvironment(config, spec);
    const createArgs = [
      `new --name=${vmName}`,
      "--no-email",
      `--tag=gitterm-${config.workspaceId}`,
      metadata.image ? `--image=${shellQuote(metadata.image)}` : "",
      metadata.cpu ? `--cpu=${metadata.cpu}` : "",
      metadata.memory ? `--memory=${metadata.memory}` : "",
      metadata.disk ? `--disk=${metadata.disk}` : "",
      ...Object.entries(environment).map(
        ([key, value]) => `--env=${shellQuote(`${key}=${value}`)}`,
      ),
    ]
      .filter(Boolean)
      .join(" ");

    await logger.step("create-vm", () => this.execute(createArgs));
    try {
      await logger.step("create-workspace-directory", () =>
        this.runVmCommand(handle, `mkdir -p ${shellQuote(handle.repoDir)}`),
      );
      if (handle.sshPublicKey) {
        await logger.step("authorize-ssh-key", () =>
          this.execute(
            `ssh-key add --tag=gitterm-${config.workspaceId} ${shellQuote(handle.sshPublicKey!)}`,
          ),
        );
      }
      if (spec?.repo) {
        const repoUrl = spec.repo.url.endsWith(".git") ? spec.repo.url : `${spec.repo.url}.git`;
        const inlineAuth = inlineGitAuthCommands(spec.repo);
        if (inlineAuth) {
          await logger.step("configure-git-auth", () =>
            this.runVmCommand(handle, inlineAuth.configure),
          );
        } else if (spec.repo.authToken) {
          const helper =
            '!f() { [ "$1" = get ] || exit 0; printf "%s\\n" "protocol=https" "host=github.com" "username=x-access-token" "password=$GITHUB_APP_TOKEN"; }; f';
          await logger.step("configure-git-auth", () =>
            this.runVmCommand(
              handle,
              `git config --global credential.helper ${shellQuote(helper)}`,
            ),
          );
        }
        const branch = spec.repo.checkoutRef || spec.repo.branch;
        await logger.step("clone-repository", () =>
          this.runVmCommand(
            handle,
            `GIT_TERMINAL_PROMPT=0 git clone ${branch ? `--branch ${shellQuote(branch)}` : ""} ${shellQuote(repoUrl)} ${shellQuote(handle.repoDir)}`,
          ),
        );
        if (spec.repo.baseCommit) {
          await logger.step("checkout-base-commit", () =>
            this.runVmCommand(
              handle,
              `GIT_TERMINAL_PROMPT=0 git -C ${shellQuote(handle.repoDir)} fetch --depth 1 origin ${shellQuote(spec.repo!.baseCommit!)} && git -C ${shellQuote(handle.repoDir)} checkout --detach ${shellQuote(spec.repo!.baseCommit!)}`,
            ),
          );
        }
      }
      await logger.step("write-agent-files", () => this.writeAgentFiles(handle, spec));
      if (spec?.beforeAgentCommand) {
        await logger.step("before-agent-setup", () =>
          this.runBeforeAgentSetup(handle, spec.beforeAgentCommand!),
        );
      }
      await logger.step("start-agent-server", () => this.startAgentServer(handle));
      if (spec?.agent.serve?.postStartCommand) {
        await logger.step("run-post-start-command", () =>
          this.runVmCommand(
            handle,
            `cd ${shellQuote(handle.repoDir)} && (${spec.agent.serve!.postStartCommand}) > /tmp/agent-post-start.log 2>&1 &`,
          ).catch((error) => console.error("exe.dev post-start command failed:", error)),
        );
      }
      await logger.step("configure-agent-port", () =>
        this.execute(`share port ${vmName} ${serve.port}`),
      );
      await logger.step("set-private-access", () => this.execute(`share set-private ${vmName}`));
      const token = await logger.step("create-vm-access-token", () =>
        this.getVmAccessToken(vmName),
      );
      const now = new Date();
      const workspaceInfo: WorkspaceInfo = {
        externalServiceId: serializeHandle(handle),
        upstreamUrl: `https://${vmName}.exe.xyz`,
        upstreamAccess: { headers: { "X-Exedev-Authorization": `Bearer ${token}` } },
        domain: this.getDomain(config.subdomain),
        serviceCreatedAt: now,
      };
      if (!persistent) return workspaceInfo;
      return { ...workspaceInfo, externalVolumeId: vmName, volumeCreatedAt: now };
    } catch (error) {
      await this.execute(`rm ${vmName}`).catch(() => undefined);
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
    const result = await this.runVmCommand(parseHandle(externalId), command);
    return { exitCode: 0, stdout: typeof result === "string" ? result : JSON.stringify(result) };
  }

  async pauseWorkspace(externalId: string): Promise<void> {
    await this.execute(`pause ${parseHandle(externalId).vmName}`);
  }

  async resumeWorkspace(externalId: string): Promise<void> {
    const handle = parseHandle(externalId);
    await this.execute(`resume ${handle.vmName}`);
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    await this.execute(`rm ${parseHandle(externalId).vmName}`);
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const handle = parseHandle(externalId);
      const result = await this.execute(`ls ${handle.vmName}`);
      const data = result as { status?: string; vms?: Array<{ status?: string }> };
      const status = data.status ?? data.vms?.[0]?.status;
      if (status === "running") return { status: "running" };
      if (status === "paused") return { status: "paused" };
      if (status === "creating") return { status: "pending" };
      return { status: "terminated" };
    } catch {
      return { status: "terminated" };
    }
  }

  async createOrGetExposedPortDomain(
    externalId: string,
    port: number,
  ): Promise<{ domain: string; upstreamAccess?: UpstreamAccess }> {
    const handle = parseHandle(externalId);
    const token = await this.getVmAccessToken(handle.vmName);
    return {
      domain: `https://${handle.vmName}.exe.xyz:${port}`,
      upstreamAccess: { headers: { "X-Exedev-Authorization": `Bearer ${token}` } },
    };
  }

  async getWorkspaceSSHAccess(config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    const handle = parseHandle(config.externalServiceId);
    if (!handle.sshPublicKey) throw new Error("exe.dev workspace requires a user SSH public key.");
    const host = `${handle.vmName}.exe.xyz`;
    const user = "exedev";
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
      sshConfigSnippet: buildStandardSshConfigSnippet({ hostAlias, host, port, user }),
      projectPathHint: config.projectPathHint.replace(/^\/workspace/, WORKSPACE_DIR),
      connection: { transportKind: "direct-ssh", host, port },
      notes: ["exe.dev authorizes your SSH key for this workspace tag."],
    };
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}

  async removeExposedPortDomain(_externalPortDomainId: string): Promise<void> {}
}

export const exeDevProvider = new ExeDevProvider();
