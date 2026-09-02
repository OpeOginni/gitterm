import { BoxApi, Configuration, waitUntilReady } from "@asciidev/box-sdk";
import env from "@gitterm/env/server";
import type { AsciiImageProviderMetadata } from "@gitterm/db/schema/cloud";
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
import type { AsciiConfig } from "./types";

export type { AsciiConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;
const WORKSPACE_DIR = "/home/user";
const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;

type AsciiHandle = {
  boxId: string;
  repoDir: string;
  serve: { command: string; port: number };
  sshPublicKey?: string;
};

function serializeHandle(handle: AsciiHandle): string {
  return JSON.stringify(handle);
}

function parseHandle(value: string): AsciiHandle {
  try {
    const handle = JSON.parse(value) as AsciiHandle;
    if (!handle.boxId || !handle.repoDir || !handle.serve?.command || !handle.serve.port) {
      throw new Error("missing required fields");
    }
    return handle;
  } catch {
    throw new Error("Invalid Ascii Box workspace handle.");
  }
}

function getTokenAccess(token: string): UpstreamAccess {
  return { headers: { "X-GitTerm-Ascii-Token": token } };
}

export class AsciiProvider implements ComputeProvider {
  readonly name = "ascii";

  async getConfig(): Promise<AsciiConfig> {
    const config = await getProviderConfigService().getProviderConfigForUse(this.name);
    if (!config) {
      throw new Error(
        "Ascii Box provider is not configured. Please configure it in the admin panel.",
      );
    }
    return config as AsciiConfig;
  }

  private async getClient(): Promise<BoxApi> {
    const { apiKey } = await this.getConfig();
    if (!apiKey) throw new Error("Ascii Box API key is not configured.");
    return new BoxApi(
      new Configuration({
        basePath: "https://ascii.dev/api/box/v1",
        accessToken: apiKey,
      }),
    );
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

  private getImageMetadata(config: WorkspaceConfig): AsciiImageProviderMetadata {
    const metadata = config.imageProviderMetadata?.ascii as AsciiImageProviderMetadata | undefined;
    return metadata ?? {};
  }

  private getEnvironment(config: WorkspaceConfig, spec: WorkspaceProvisioningSpec | null) {
    return Object.fromEntries(
      Object.entries({ ...config.environmentVariables, ...spec?.agent.env }).filter(
        ([name, value]) => name !== "AGENT_FILES_BASE64" && value !== undefined,
      ),
    ) as Record<string, string>;
  }

  private async runCommand(
    client: BoxApi,
    boxId: string,
    command: string,
    cwd?: string,
    timeoutSeconds = 60,
  ): Promise<string> {
    const result = await client.command({
      boxId,
      commandRequest: { command, cwd, timeoutSeconds },
    });
    if (result.type !== "command.finished") {
      throw new Error("Ascii Box command did not finish");
    }
    if (!result.success || result.exitCode !== 0) {
      throw new Error(`Ascii Box command failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  private async writeAgentFiles(
    client: BoxApi,
    boxId: string,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ) {
    for (const file of spec?.agent.files ?? []) {
      const path = file.relativeToRepo
        ? `${repoDir}/${file.path}`
        : file.path.startsWith("~/")
          ? file.path.slice(2)
          : file.path;
      await client.writeFile({
        boxId,
        fileWriteRequest: { path, content: file.contentBase64, encoding: "base64" },
      });
      if (file.mode)
        await this.runCommand(client, boxId, `chmod ${file.mode.toString(8)} '${path}'`);
    }
  }

  private async setupAgent(
    client: BoxApi,
    boxId: string,
    commands: string[] | undefined,
  ): Promise<void> {
    for (const command of commands ?? []) {
      await this.runCommand(client, boxId, command, undefined, 600);
    }
  }

  private async startAgentServer(client: BoxApi, handle: AsciiHandle): Promise<void> {
    const escaped = handle.serve.command.replace(/'/g, `"'"'`);
    await this.runCommand(
      client,
      handle.boxId,
      `nohup setsid bash -lc '${escaped}' > /tmp/agent-server.log 2>&1 </dev/null &`,
      handle.repoDir,
    );
  }

  private async getPrivateUrl(
    client: BoxApi,
    boxId: string,
    port: number,
  ): Promise<{
    url: string;
    token: string;
  }> {
    await this.runCommand(client, boxId, `host ${port} --private`);
    const output = await this.runCommand(client, boxId, `host url ${port}`);
    const value = output.match(/https:\/\/\S+/)?.[0];
    if (!value) throw new Error(`Ascii Box did not return a hosted URL for port ${port}.`);
    const hosted = new URL(value);
    const token = hosted.searchParams.get("_token");
    if (!token) throw new Error(`Ascii Box did not return a private token for port ${port}.`);
    hosted.search = "";
    return { url: hosted.toString(), token };
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
    const client = await this.getClient();
    const metadata = this.getImageMetadata(config);
    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;
    const repoDir = spec?.repo?.name ?? "workspace";
    const created = await logger.step("create-box", () =>
      client.create({
        createBoxRequest: {
          type: metadata.size,
          ttlSeconds: null,
          noEnv: true,
          env: this.getEnvironment(config, spec),
        },
      }),
    );
    const handle: AsciiHandle = {
      boxId: created.box.id,
      repoDir,
      serve,
      sshPublicKey: spec?.sshPublicKey,
    };

    try {
      await logger.step("wait-for-box", () => waitUntilReady(client, handle.boxId));
      await logger.step("name-box", () =>
        client.update({
          boxId: handle.boxId,
          updateBoxRequest: { name: `gitterm-${config.workspaceId}` },
        }),
      );
      await logger.step("create-workspace-directory", () =>
        this.runCommand(client, handle.boxId, `mkdir -p "${repoDir}"`),
      );
      await logger.step("setup-agent", () =>
        this.setupAgent(client, handle.boxId, metadata.setupCommands),
      );

      if (spec?.repo) {
        const repoUrl = spec.repo.url.endsWith(".git") ? spec.repo.url : `${spec.repo.url}.git`;
        const inlineAuth = inlineGitAuthCommands(spec.repo);
        if (inlineAuth) {
          await logger.step("configure-git-auth", () =>
            this.runCommand(client, handle.boxId, inlineAuth.configure),
          );
        } else if (spec.repo.authToken) {
          await logger.step("configure-git-auth", () =>
            this.runCommand(
              client,
              handle.boxId,
              `git config --global credential.helper '!f() { [ "$1" = get ] || exit 0; printf "%s\\n" "protocol=https" "host=github.com" "username=x-access-token" "password=$GITHUB_APP_TOKEN"; }; f'`,
            ),
          );
        }
        await logger.step("clone-repository", () =>
          this.runCommand(
            client,
            handle.boxId,
            `GIT_TERMINAL_PROMPT=0 git clone ${spec.repo!.checkoutRef || spec.repo!.branch ? `--branch ${spec.repo!.checkoutRef || spec.repo!.branch}` : ""} "${repoUrl}" .`,
            repoDir,
          ),
        );
        if (spec.repo.baseCommit) {
          await logger.step("checkout-base-commit", () =>
            this.runCommand(
              client,
              handle.boxId,
              `GIT_TERMINAL_PROMPT=0 git fetch --depth 1 origin ${spec.repo!.baseCommit} && git checkout --detach ${spec.repo!.baseCommit}`,
              repoDir,
            ),
          );
        }
      }

      await logger.step("write-agent-files", () =>
        this.writeAgentFiles(client, handle.boxId, spec, repoDir),
      );
      if (spec?.beforeAgentCommand) {
        await logger.step("before-agent-setup", () =>
          this.runCommand(client, handle.boxId, spec.beforeAgentCommand!, repoDir, 600).catch(
            (error: unknown) => {
              throw new BeforeAgentSetupError(error instanceof Error ? error.message : "");
            },
          ),
        );
      }
      await logger.step("start-agent-server", () => this.startAgentServer(client, handle));
      const postStartCommand = spec?.agent.serve?.postStartCommand;
      if (postStartCommand) {
        await logger.step("run-post-start-command", () =>
          this.runCommand(client, handle.boxId, postStartCommand, repoDir).catch((error) =>
            console.error("Ascii Box post-start command failed:", error),
          ),
        );
      }

      const primaryUrl = await logger.step("create-agent-host", () =>
        this.getPrivateUrl(client, handle.boxId, serve.port),
      );
      const now = new Date();
      const workspaceInfo: WorkspaceInfo = {
        externalServiceId: serializeHandle(handle),
        upstreamUrl: primaryUrl.url,
        upstreamAccess: getTokenAccess(primaryUrl.token),
        domain: this.getDomain(config.subdomain),
        serviceCreatedAt: now,
      };
      if (!persistent) return workspaceInfo;
      return { ...workspaceInfo, externalVolumeId: handle.boxId, volumeCreatedAt: now };
    } catch (error) {
      await client
        .stop({ boxId: handle.boxId, stopRequest: { force: true } })
        .catch(() => undefined);
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
    const handle = parseHandle(externalId);
    const client = await this.getClient();
    const result = await client.command({
      boxId: handle.boxId,
      commandRequest: { command, cwd: handle.repoDir, timeoutSeconds: 60 },
    });
    if (result.type !== "command.finished") {
      return { exitCode: 1, stdout: "" };
    }
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout };
  }

  async pauseWorkspace(externalId: string): Promise<void> {
    const handle = parseHandle(externalId);
    await (await this.getClient()).stop({ boxId: handle.boxId });
  }

  async resumeWorkspace(externalId: string): Promise<void> {
    const handle = parseHandle(externalId);
    const client = await this.getClient();
    await client.resume({ boxId: handle.boxId, resumeRequest: { noEnv: true } });
    await waitUntilReady(client, handle.boxId);
    await this.startAgentServer(client, handle);
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    const handle = parseHandle(externalId);
    const { apiKey } = await this.getConfig();
    const response = await fetch(`https://ascii.dev/api/box/v1/boxes/${handle.boxId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Ascii Box deletion failed (${response.status}).`);
    }
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    try {
      const handle = parseHandle(externalId);
      const box = (await (await this.getClient()).get({ boxId: handle.boxId })).box;
      if (box.state === "ready" || box.state === "idle" || box.state === "running") {
        return { status: "running", lastActiveAt: box.updatedAt ?? undefined };
      }
      if (["init", "provisioning", "provisioned", "cloning", "archiving"].includes(box.state)) {
        return { status: "pending", lastActiveAt: box.updatedAt ?? undefined };
      }
      if (box.state === "archived")
        return { status: "paused", lastActiveAt: box.updatedAt ?? undefined };
      return { status: "terminated", lastActiveAt: box.updatedAt ?? undefined };
    } catch {
      return { status: "terminated" };
    }
  }

  async keepAliveWorkspace(externalId: string, timeoutMs: number): Promise<void> {
    const handle = parseHandle(externalId);
    await (
      await this.getClient()
    ).update({
      boxId: handle.boxId,
      updateBoxRequest: { ttlSeconds: Math.ceil(timeoutMs / 1000) },
    });
  }

  async createOrGetExposedPortDomain(
    externalId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const handle = parseHandle(externalId);
    const hosted = await this.getPrivateUrl(await this.getClient(), handle.boxId, port);
    return {
      domain: hosted.url,
      externalPortDomainId: `${handle.boxId}:${port}`,
      upstreamAccess: getTokenAccess(hosted.token),
    };
  }

  async getWorkspaceSSHAccess(config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    const handle = parseHandle(config.externalServiceId);
    if (!handle.sshPublicKey) throw new Error("Ascii Box SSH requires a user SSH public key.");
    const client = await this.getClient();
    const response = await client.sshKey({
      boxId: handle.boxId,
      sshKeyRequest: { key: handle.sshPublicKey },
    });
    const host = response.machineIp;
    if (!host) throw new Error("Ascii Box did not return an SSH host.");
    const user = response.sshUser ?? "user";
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
      notes: ["Your saved SSH public key is authorized for this workspace."],
    };
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {
    // Ascii Box currently exposes key addition but no key revocation endpoint.
  }

  async removeExposedPortDomain(externalPortDomainId: string): Promise<void> {
    const [boxId, port] = externalPortDomainId.split(":");
    if (!boxId || !port) return;
    await this.runCommand(await this.getClient(), boxId, `host hide ${port}`);
  }
}

export const asciiProvider = new AsciiProvider();
