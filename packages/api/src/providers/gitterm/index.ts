import env from "@gitterm/env/server";
import type { SandboxTransport } from "@gitterm/agent-runtime/sandbox/types";
import { captureAgentAccessCredential } from "../access-credential";
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
import { inlineGitAuthCommands } from "../git-auth";
import { createProvisionLogger } from "../provision-logger";
import { resolveProvisioningSpec } from "../provisioning-spec";
import type {
  WorkspaceSSHAccess,
  WorkspaceSSHAccessCleanupConfig,
  WorkspaceSSHAccessConfig,
} from "../ssh-access";
import {
  managedSandboxTransport,
  parseSandboxHandle,
  sandboxHandle,
} from "../../service/sandbox-transport";
import { getWorkspaceIdleTimeoutMs } from "../../service/workspace-timeouts";
import { proxyRouteHeaders } from "../../service/proxy-route-headers";

const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;

/** Mirrors `resolveProjectDirectory` for the `gitterm` key: repos live in ~/workspace/<name>. */
const WORKSPACE_ROOT = "/home/user/workspace";

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Starts the agent server once: a resume runs it again, so skip it when the port answers. */
function startAgentCommand(serve: { command: string; port: number }, repoDir: string) {
  return [
    `cd ${quote(repoDir)}`,
    `(bash -c ${quote(`exec 3<>/dev/tcp/127.0.0.1/${serve.port}`)} 2>/dev/null ||`,
    `nohup setsid bash -lc ${quote(serve.command)} > /tmp/agent-server.log 2>&1 </dev/null &)`,
  ].join(" && ");
}

/**
 * Agent workspaces on Gitterm's own sandboxes (gitterm.dev only). Built from the generic
 * sandbox calls: create with the image and size, run commands, write files, and open the
 * agent's port. The workspace keeps a `sandbox:gitterm:<id>` handle, so pause, resume,
 * terminate, status, keep-alive and exec go through the sandbox transport
 * (`withSandboxHandles`). Workspaces keep their files while paused, so they are always
 * persistent; there is no SSH access.
 */
export class GittermProvider implements ComputeProvider {
  readonly name = "gitterm";

  private transport(): Promise<SandboxTransport> {
    return managedSandboxTransport("gitterm");
  }

  private getDomain(subdomain: string): string {
    const local = env.BASE_DOMAIN.includes("localhost");
    if (env.ROUTING_MODE === "path")
      return `${local ? "http" : "https"}://${env.BASE_DOMAIN}/ws/${subdomain}`;
    return `${local ? "http" : "https"}://${subdomain}.${env.BASE_DOMAIN}`;
  }

  private async run(
    transport: SandboxTransport,
    id: string,
    command: string,
    cwd?: string,
    timeoutMs = 60_000,
  ): Promise<string> {
    const result = await transport.run(id, command, { cwd, timeoutMs });
    if (result.exitCode !== 0)
      throw new Error(
        `Command failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    return result.stdout;
  }

  private async writeAgentFiles(
    transport: SandboxTransport,
    id: string,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
  ) {
    for (const file of spec?.agent.files ?? []) {
      const path = file.relativeToRepo
        ? `${repoDir}/${file.path}`
        : file.path.startsWith("~/")
          ? `${transport.home}/${file.path.slice(2)}`
          : file.path;
      const mode = file.mode ? ` && chmod ${file.mode.toString(8)} ${quote(path)}` : "";
      // Runtime secrets like /run/gitterm/... live outside the user's home: create a
      // user-owned directory with sudo, as commands run as the sandbox user.
      if (!path.startsWith(`${transport.home}/`) && !path.startsWith("/tmp/")) {
        const dir = path.slice(0, path.lastIndexOf("/")) || "/";
        await this.run(
          transport,
          id,
          `sudo -n mkdir -p ${quote(dir)} && sudo -n chown "$(id -u):$(id -g)" ${quote(dir)} && chmod 700 ${quote(dir)} && printf %s '${file.contentBase64}' | base64 -d > ${quote(path)}${mode}`,
        );
        continue;
      }
      await this.run(transport, id, `mkdir -p ${quote(path.slice(0, path.lastIndexOf("/")))}`);
      await transport.writeFile(id, path, Buffer.from(file.contentBase64, "base64"));
      if (mode) await this.run(transport, id, `chmod ${file.mode!.toString(8)} ${quote(path)}`);
    }
  }

  private async provisionWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    const spec = resolveProvisioningSpec(config);
    const logger = createProvisionLogger(
      this.name,
      config.workspaceId,
      spec?.repo?.authToken ? [spec.repo.authToken] : [],
    );
    const metadata = config.imageProviderMetadata?.gitterm as
      | { image?: string; size?: string }
      | undefined;
    if (!metadata?.image) throw new Error("This image is not available on Gitterm.");
    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;
    const repoDir = `${WORKSPACE_ROOT}/${spec?.repo?.name ?? "workspace"}`;
    const transport = await this.transport();
    const environment = Object.fromEntries(
      Object.entries({ ...spec?.agent.env, ...config.environmentVariables }).filter(
        ([name, value]) => name !== "AGENT_FILES_BASE64" && value !== undefined,
      ),
    ) as Record<string, string>;

    const created = await logger.step("create-sandbox", async () =>
      transport.create({
        labels: { gitterm_workspace: config.workspaceId },
        timeoutMs: await getWorkspaceIdleTimeoutMs(config.userId),
        onTimeout: "pause",
        template: metadata.image,
        machine: { size: metadata.size ?? "medium" },
        env: environment,
        resumeCommand: startAgentCommand(serve, repoDir),
      }),
    );
    const id = created.id;

    try {
      await logger.step("create-workspace-directory", () =>
        this.run(transport, id, `mkdir -p ${quote(repoDir)}`),
      );
      if (spec?.repo) {
        const repoUrl = spec.repo.url.endsWith(".git") ? spec.repo.url : `${spec.repo.url}.git`;
        const inlineAuth = inlineGitAuthCommands(spec.repo);
        if (inlineAuth) {
          await logger.step("configure-git-auth", () =>
            this.run(transport, id, inlineAuth.configure),
          );
        } else if (spec.repo.authToken) {
          await logger.step("configure-git-auth", () =>
            this.run(
              transport,
              id,
              `git config --global credential.helper '!f() { [ "$1" = get ] || exit 0; printf "%s\\n" "protocol=https" "host=github.com" "username=x-access-token" "password=$GITHUB_APP_TOKEN"; }; f'`,
            ),
          );
        }
        const ref = spec.repo.checkoutRef || spec.repo.branch;
        await logger.step("clone-repository", () =>
          this.run(
            transport,
            id,
            `GIT_TERMINAL_PROMPT=0 git clone ${ref ? `--branch ${quote(ref)}` : ""} ${quote(repoUrl)} .`,
            repoDir,
            600_000,
          ),
        );
        if (spec.repo.baseCommit) {
          await logger.step("checkout-base-commit", () =>
            this.run(
              transport,
              id,
              `GIT_TERMINAL_PROMPT=0 git fetch --depth 1 origin ${spec.repo!.baseCommit} && git checkout --detach ${spec.repo!.baseCommit}`,
              repoDir,
              600_000,
            ),
          );
        }
      }

      await logger.step("write-agent-files", () =>
        this.writeAgentFiles(transport, id, spec, repoDir),
      );
      if (spec?.beforeAgentCommand) {
        await logger.step("before-agent-setup", () =>
          this.run(transport, id, spec.beforeAgentCommand!, repoDir, 600_000).catch(
            (error: unknown) => {
              throw new BeforeAgentSetupError(error instanceof Error ? error.message : "");
            },
          ),
        );
      }
      const accessCredential = await logger.step("capture-access-credential", () =>
        captureAgentAccessCredential(
          spec?.agent.serve?.accessCredentialCommand,
          async (command) => ({
            exitCode: 0,
            stdout: await this.run(transport, id, command, repoDir),
          }),
        ),
      );
      await logger.step("start-agent-server", () =>
        this.run(transport, id, startAgentCommand(serve, repoDir)),
      );
      const postStartCommand = spec?.agent.serve?.postStartCommand;
      if (postStartCommand) {
        await logger.step("run-post-start-command", () =>
          this.run(transport, id, postStartCommand, repoDir).catch((error) =>
            console.error("Gitterm post-start command failed:", error),
          ),
        );
      }
      const preview = await logger.step("open-agent-port", () => transport.preview(id, serve.port));
      return {
        externalServiceId: sandboxHandle("gitterm", id),
        upstreamUrl: preview.url,
        upstreamAccess: { headers: proxyRouteHeaders(preview.headers) },
        domain: this.getDomain(config.subdomain),
        serviceCreatedAt: created.startedAt ? new Date(created.startedAt) : new Date(),
        accessCredential,
      };
    } catch (error) {
      await transport.destroy(id).catch(() => undefined);
      throw error;
    }
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return this.provisionWorkspace(config);
  }

  /** Every Gitterm workspace keeps its files while paused; the sandbox is its volume. */
  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    const info = await this.provisionWorkspace(config);
    return { ...info, externalVolumeId: info.externalServiceId, volumeCreatedAt: new Date() };
  }

  // Lifecycle calls arrive with the `sandbox:gitterm:<id>` handle and are served by
  // `withSandboxHandles`; reaching these means the handle was not a Gitterm sandbox.
  async pauseWorkspace(externalId: string): Promise<void> {
    throw new Error(`Not a Gitterm workspace: ${externalId}`);
  }

  async resumeWorkspace(externalId: string): Promise<void> {
    throw new Error(`Not a Gitterm workspace: ${externalId}`);
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    throw new Error(`Not a Gitterm workspace: ${externalId}`);
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    throw new Error(`Not a Gitterm workspace: ${externalId}`);
  }

  async createOrGetExposedPortDomain(
    externalId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const handle = parseSandboxHandle(externalId);
    if (handle?.provider !== "gitterm") throw new Error(`Not a Gitterm workspace: ${externalId}`);
    const preview = await (await this.transport()).preview(handle.id, port);
    return {
      domain: preview.url,
      externalPortDomainId: `${handle.id}:${port}`,
      upstreamAccess: { headers: proxyRouteHeaders(preview.headers) },
    };
  }

  // Ports are opened per request and closed with the sandbox.
  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {}

  async getWorkspaceSSHAccess(_config: WorkspaceSSHAccessConfig): Promise<WorkspaceSSHAccess> {
    throw new Error("Gitterm workspaces do not offer SSH access.");
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}
}

export const gittermProvider = new GittermProvider();
