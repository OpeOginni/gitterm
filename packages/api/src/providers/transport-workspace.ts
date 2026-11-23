import env from "@gitterm/env/server";
import {
  SANDBOX_PROVIDER_PROFILES,
  type SandboxProviderKey,
  type SandboxTransport,
} from "@gitterm/agent-runtime/sandbox/types";
import { captureAgentAccessCredential } from "./access-credential";
import { BeforeAgentSetupError, WorkspaceProvisionError } from "./compute";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceProvisioningSpec,
  WorkspaceStatusResult,
} from "./compute";
import { repositoryCheckoutCommand } from "./project-snapshot";
import { inlineGitAuthCommands } from "./git-auth";
import { createProvisionLogger } from "./provision-logger";
import type {
  WorkspaceSSHAccess,
  WorkspaceSSHAccessCleanupConfig,
  WorkspaceSSHAccessConfig,
} from "./ssh-access";
import {
  managedSandboxTransport,
  parseSandboxHandle,
  sandboxHandle,
} from "../service/sandbox-transport";
import { getWorkspaceIdleTimeoutMs } from "../service/workspace-timeouts";
import { proxyRouteHeaders } from "../service/proxy-route-headers";

const DEFAULT_AGENT_SERVE = {
  command: "opencode serve --hostname 0.0.0.0 --port 4096",
  port: 4096,
} as const;

/** The agent's start command, kept in the sandbox user's home for resumes. */
const RESUME_SCRIPT = '"$HOME/.gitterm/resume.sh"';
/** The label that keeps the agent's port, to find its new URL after a resume. */
const AGENT_PORT_LABEL = "gitterm_agent_port";

/**
 * Env only container entrypoints read. Here GitTerm clones and writes the agent's files
 * itself, and some providers cap the environment's size (Vercel at 4 KiB).
 */
const ENTRYPOINT_ONLY_ENV = new Set([
  "AGENT_FILES_BASE64",
  "REPO_BASE_COMMIT",
  "REPO_BRANCH",
  "REPO_CHECKOUT_REF",
  "REPO_NAME",
  "REPO_OWNER",
  "REPO_URL",
  "USER_GITHUB_USERNAME",
  "USER_EMAIL",
  "USER_SSH_PUBLIC_KEY",
  "WORKSPACE_BEFORE_AGENT_COMMAND_BASE64",
  "WORKSPACE_SETUP_COMMAND_BASE64",
  "WORKSPACE_TOOLING_MANIFEST_BASE64",
]);

/**
 * After a resume: starts the agent again on transports that don't run a resume command
 * themselves, and returns the agent's new URL where a resume changes it (Vercel). Plain
 * sandboxes have no script and no agent port, so this does nothing for them.
 */
export async function afterResume(
  transport: SandboxTransport,
  id: string,
): Promise<{ upstreamUrl: string } | undefined> {
  const profile = SANDBOX_PROVIDER_PROFILES[transport.provider];
  if (!profile.resumeCommand) {
    const result = await transport.run(id, `[ ! -f ${RESUME_SCRIPT} ] || bash ${RESUME_SCRIPT}`, {
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0)
      throw new Error(`The agent didn't start after the resume: ${result.stderr || result.stdout}`);
  }
  if (!profile.resumeChangesPreviewUrls) return undefined;
  const port = Number((await transport.info(id)).labels[AGENT_PORT_LABEL]);
  if (!port) return undefined;
  return { upstreamUrl: (await transport.preview(id, port)).url };
}

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

/** The end of a failed command's output: git and friends put the reason last. */
const lastLines = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/^Command failed \(exit \d+\): /, "")
    .trim()
    .split("\n")
    .slice(-3)
    .join(" ")
    .slice(-500);

/** Starts the agent server once: a resume runs it again, so skip it when the port answers. */
function startAgentCommand(serve: { command: string; port: number }, repoDir: string) {
  const answers = `bash -c ${quote(`exec 3<>/dev/tcp/127.0.0.1/${serve.port}`)} 2>/dev/null`;
  const start = `nohup setsid bash -lc ${quote(serve.command)} > /tmp/agent-server.log 2>&1 </dev/null &`;
  // Running means the agent answers, so wait for its port (resume runs this as well).
  const wait = `i=0; until ${answers}; do i=$((i+1)); [ $i -lt 50 ] || { echo "The agent did not open port ${serve.port}; see /tmp/agent-server.log" >&2; exit 1; }; sleep 1; done`;
  return `cd ${quote(repoDir)} && { ${answers} || { ${start} }; } && { ${wait}; }`;
}

export type TransportWorkspaceOptions = {
  /** The provider's name in messages to the user. */
  label: string;
  /**
   * The directory that holds the checkout, `<root>/<repo>`. Defaults to `~/workspace`.
   * `resolveProjectDirectory` must give the same path.
   */
  root?: string;
  /** Machine options used when the image and machine profile set none. */
  defaultMachine?: Record<string, unknown>;
};

/**
 * Agent workspaces on any sandbox provider, built only from the `SandboxTransport` calls:
 * create with the image and machine, run commands, write files, and open the agent's port.
 * Adding a provider's transport is all a provider needs for workspaces.
 *
 * The image's provider metadata (`imageProviderMetadata[provider]`, with the machine
 * profile's options merged in) gives `image` (or `template`, `templateId`), the transport's
 * template; `setupCommands`, run before the checkout to install the agent on a plain image;
 * and the rest, passed on as the transport's `machine` options.
 *
 * A resume starts the agent again: through `resumeCommand` where the transport runs one,
 * otherwise through `~/.gitterm/resume.sh`, which `withSandboxHandles` runs.
 *
 * The workspace keeps a `sandbox:<provider>:<id>` handle, so pause, resume, terminate,
 * status, keep-alive and exec go through the transport (`withSandboxHandles`). The sandbox is
 * its own volume, so workspaces are always persistent; there is no SSH access.
 */
export class TransportWorkspaceProvider implements ComputeProvider {
  constructor(
    readonly name: SandboxProviderKey,
    private readonly options: TransportWorkspaceOptions,
  ) {}

  private transport(): Promise<SandboxTransport> {
    return managedSandboxTransport(this.name);
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

  /** `home` is the sandbox user's `$HOME`, which an image can set apart from the provider's. */
  private async writeAgentFiles(
    transport: SandboxTransport,
    id: string,
    spec: WorkspaceProvisioningSpec | null,
    repoDir: string,
    home: string,
  ) {
    for (const file of spec?.agent.files ?? []) {
      const path = file.relativeToRepo
        ? `${repoDir}/${file.path}`
        : file.path.startsWith("~/")
          ? `${home}/${file.path.slice(2)}`
          : file.path;
      const mode = file.mode ? ` && chmod ${file.mode.toString(8)} ${quote(path)}` : "";
      // Runtime secrets like /run/gitterm/... live outside the user's home: create a
      // user-owned directory with sudo, as commands run as the sandbox user.
      if (!path.startsWith(`${home}/`) && !path.startsWith("/tmp/")) {
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
    const spec = config.provisioningSpec ?? null;
    const logger = createProvisionLogger(
      this.name,
      config.workspaceId,
      spec?.repo?.authToken ? [spec.repo.authToken] : [],
    );
    const { label, defaultMachine } = this.options;
    const nativeResume = SANDBOX_PROVIDER_PROFILES[this.name].resumeCommand;
    const metadata = config.imageProviderMetadata?.[this.name] as
      | ({
          image?: string;
          template?: string;
          templateId?: string;
          setupCommands?: string[];
          // SSH variants, which these workspaces don't offer.
          sshTemplateId?: string;
          editorResources?: unknown;
        } & Record<string, unknown>)
      | undefined;
    if (!metadata) throw new Error(`This image is not available on ${label}.`);
    const {
      image,
      template,
      templateId,
      setupCommands = [],
      sshTemplateId: _ssh,
      editorResources: _editor,
      ...profile
    } = metadata;
    const machine = Object.keys(profile).length ? profile : defaultMachine;
    const serve = spec?.agent.serve ?? DEFAULT_AGENT_SERVE;
    const transport = await this.transport();
    const root = this.options.root ?? `${transport.home}/workspace`;
    const repoDir = `${root}/${spec?.repo?.name ?? "workspace"}`;
    const resume = startAgentCommand(serve, repoDir);
    const environment = Object.fromEntries(
      Object.entries({ ...spec?.agent.env, ...config.environmentVariables }).filter(
        ([name, value]) => !ENTRYPOINT_ONLY_ENV.has(name) && value !== undefined,
      ),
    ) as Record<string, string>;

    const created = await logger.step("create-sandbox", async () =>
      transport
        .create({
          labels: { gitterm_workspace: config.workspaceId, [AGENT_PORT_LABEL]: String(serve.port) },
          timeoutMs: await getWorkspaceIdleTimeoutMs(config.userId),
          onTimeout: "pause",
          template: image ?? template ?? templateId,
          ...(machine ? { machine } : {}),
          env: environment,
          ...(nativeResume ? { resumeCommand: resume } : {}),
          ...(config.snapshot ? { snapshot: config.snapshot } : {}),
        })
        .catch((error: unknown) => {
          const size = typeof machine?.size === "string" ? `a ${machine.size}` : "a";
          throw new WorkspaceProvisionError(
            "SERVICE_UNAVAILABLE",
            `${label} couldn't start ${size} machine. ${error instanceof Error ? error.message : ""}`.trim(),
          );
        }),
    );
    const id = created.id;

    try {
      // Recorded first, so a sandbox whose setup fails is still deleted if the cleanup below fails.
      await config.onProvisioned?.({ externalServiceId: sandboxHandle(this.name, id) });
      const home = (await this.run(transport, id, 'printf %s "$HOME"')).trim() || transport.home;
      // A project snapshot was saved from a workspace that had the agent installed.
      if (!config.snapshot) {
        for (const command of setupCommands) {
          await logger.step("install-agent", () =>
            this.run(transport, id, command, undefined, 600_000).catch((error: unknown) => {
              throw new WorkspaceProvisionError(
                "INTERNAL_SERVER_ERROR",
                `Installing the agent on ${label} failed: ${lastLines(error)}`,
              );
            }),
          );
        }
      }
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
            // A project snapshot already holds a clone: refresh it instead.
            config.snapshot
              ? repositoryCheckoutCommand(spec.repo!, repoUrl)
              : `GIT_TERMINAL_PROMPT=0 git clone ${ref ? `--branch ${quote(ref)}` : ""} ${quote(repoUrl)} .`,
            repoDir,
            600_000,
          ).catch((error: unknown) => {
            throw new WorkspaceProvisionError(
              "BAD_REQUEST",
              `Couldn't clone ${spec.repo!.url}${ref ? ` (branch ${ref})` : ""}: ${lastLines(error)} Check the URL and branch, and that Gitterm can access the repository.`,
            );
          }),
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
        this.writeAgentFiles(transport, id, spec, repoDir, home),
      );
      if (!nativeResume) {
        await logger.step("write-resume-script", () =>
          this.run(
            transport,
            id,
            `mkdir -p "$HOME/.gitterm" && printf %s ${quote(Buffer.from(`${resume}\n`).toString("base64"))} | base64 -d > ${RESUME_SCRIPT}`,
          ),
        );
      }
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
        this.run(transport, id, resume).catch(async () => {
          const log = await transport
            .run(id, "tail -c 1500 /tmp/agent-server.log", { timeoutMs: 10_000 })
            .then((result) => result.stdout.trim())
            .catch(() => "");
          throw new WorkspaceProvisionError(
            "INTERNAL_SERVER_ERROR",
            `The agent didn't start on port ${serve.port}.${log ? ` Its log ends with:\n${log}` : ""}`,
          );
        }),
      );
      const postStartCommand = spec?.agent.serve?.postStartCommand;
      if (postStartCommand) {
        await logger.step("run-post-start-command", () =>
          this.run(transport, id, postStartCommand, repoDir).catch((error) =>
            console.error(`${label} post-start command failed:`, error),
          ),
        );
      }
      const preview = await logger.step("open-agent-port", () => transport.preview(id, serve.port));
      return {
        externalServiceId: sandboxHandle(this.name, id),
        upstreamUrl: preview.url,
        upstreamAccess: { headers: proxyRouteHeaders(preview.headers) },
        domain: this.getDomain(config.subdomain),
        serviceCreatedAt: created.startedAt ? new Date(created.startedAt) : new Date(),
        accessCredential,
      };
    } catch (error) {
      // Failed provisioning also queues this handle for cleanup, which retries a failed delete.
      await transport.destroy(id).catch(() => undefined);
      throw error;
    }
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    return this.provisionWorkspace(config);
  }

  /** Every such workspace keeps its files while paused; the sandbox is its volume. */
  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    const info = await this.provisionWorkspace(config);
    return { ...info, externalVolumeId: info.externalServiceId, volumeCreatedAt: new Date() };
  }

  // Lifecycle calls arrive with the `sandbox:<provider>:<id>` handle and are served by
  // `withSandboxHandles`; reaching these means the handle was not one of this provider's.
  async pauseWorkspace(externalId: string): Promise<void> {
    throw new Error(`Not a ${this.options.label} workspace: ${externalId}`);
  }

  async resumeWorkspace(externalId: string): Promise<void> {
    throw new Error(`Not a ${this.options.label} workspace: ${externalId}`);
  }

  async terminateWorkspace(externalId: string): Promise<void> {
    throw new Error(`Not a ${this.options.label} workspace: ${externalId}`);
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    throw new Error(`Not a ${this.options.label} workspace: ${externalId}`);
  }

  async createOrGetExposedPortDomain(
    externalId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string; upstreamAccess?: UpstreamAccess }> {
    const handle = parseSandboxHandle(externalId);
    if (handle?.provider !== this.name)
      throw new Error(`Not a ${this.options.label} workspace: ${externalId}`);
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
    throw new Error(`${this.options.label} workspaces do not offer SSH access.`);
  }

  async revokeWorkspaceSSHAccess(_config: WorkspaceSSHAccessCleanupConfig): Promise<void> {}
}

/** Gitterm's own sandboxes (gitterm.dev only), which restart the agent on resume themselves. */
export const gittermProvider = new TransportWorkspaceProvider("gitterm", {
  label: "Gitterm",
  defaultMachine: { size: "medium" },
});
