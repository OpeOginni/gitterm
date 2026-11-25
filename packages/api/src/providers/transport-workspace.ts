import env from "@gitterm/env/server";
import type { SandboxProviderKey, SandboxTransport } from "@gitterm/agent-runtime/sandbox/types";
import {
  provisionWorkspace,
  WorkspaceSetupError,
  type WorkspacePlan,
} from "@gitterm/agent-runtime/sandbox/workspace";
import { BeforeAgentSetupError, WorkspaceProvisionError } from "./compute";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  UpstreamAccess,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "./compute";
import { imageSupportsProvider } from "./image-compat";
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

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

/** Uses `$GITHUB_APP_TOKEN` from the workspace's env, which GitTerm renews. */
const GITHUB_APP_CREDENTIAL_HELPER = `git config --global credential.helper '!f() { [ "$1" = get ] || exit 0; printf "%s\\n" "protocol=https" "host=github.com" "username=x-access-token" "password=$GITHUB_APP_TOKEN"; }; f'`;

export type TransportWorkspaceOptions = {
  /** The provider's name in messages to the user. */
  label: string;
  /** Machine options used when the image and machine profile set none. */
  defaultMachine?: Record<string, unknown>;
};

/**
 * Agent workspaces on any sandbox provider, built only from the `SandboxTransport` calls:
 * create with the image and machine, run commands, write files, and open the agent's port.
 * Adding a provider's transport is all a provider needs for workspaces.
 *
 * The image's provider metadata (`imageProviderMetadata[provider]`, with the machine
 * profile's options merged in) gives `image` (or `template`), the transport's template;
 * `setupCommands`, run before the checkout to install the agent on a plain image; and the
 * rest, passed on as the transport's `machine` options. An admin can start the image from a
 * prebuilt instead: `snapshot` (any provider with snapshots) or E2B's `templateId`. Then the
 * setup commands are skipped.
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

  private async provisionWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    const spec = config.provisioningSpec ?? null;
    const logger = createProvisionLogger(
      this.name,
      config.workspaceId,
      spec?.repo?.authToken ? [spec.repo.authToken] : [],
    );
    const { label, defaultMachine } = this.options;
    const metadata = config.imageProviderMetadata?.[this.name] as
      | ({
          image?: string;
          template?: string;
          templateId?: string;
          /** A prebuilt snapshot with the agent, chosen by an admin. */
          snapshot?: string;
          setupCommands?: string[];
          // SSH variants, which these workspaces don't offer.
          sshTemplateId?: string;
          editorResources?: unknown;
        } & Record<string, unknown>)
      | undefined;
    if (!metadata || !imageSupportsProvider(this.name, config.imageProviderMetadata))
      throw new Error(`This image is not available on ${label}.`);
    const {
      image,
      template,
      templateId,
      snapshot,
      setupCommands,
      sshTemplateId: _ssh,
      editorResources: _editor,
      ...profile
    } = metadata;
    const machine = Object.keys(profile).length ? profile : defaultMachine;
    const repo = spec?.repo;
    const ref = repo?.checkoutRef || repo?.branch;
    const transport = await this.transport();

    const plan: WorkspacePlan = {
      create: {
        labels: { gitterm_workspace: config.workspaceId },
        timeoutMs: await getWorkspaceIdleTimeoutMs(config.userId),
        onTimeout: "pause",
        template: image ?? template ?? templateId,
        ...(machine ? { machine } : {}),
        env: Object.fromEntries(
          Object.entries({ ...spec?.agent.env, ...config.environmentVariables }).filter(
            ([name, value]) => !ENTRYPOINT_ONLY_ENV.has(name) && value !== undefined,
          ),
        ) as Record<string, string>,
        // A project snapshot (the user's saved workspace) first, else the admin's prebuilt one.
        ...((config.snapshot ?? snapshot) ? { snapshot: config.snapshot ?? snapshot } : {}),
      },
      // A prebuilt snapshot or E2B template already has the agent.
      setupCommands: snapshot || templateId ? [] : setupCommands,
      name: repo?.name ?? "workspace",
      ...(repo ? { checkout: checkout(repo, ref, config.snapshot) } : {}),
      files: spec?.agent.files ?? [],
      beforeAgent: spec?.beforeAgentCommand,
      accessCredentialCommand: spec?.agent.serve?.accessCredentialCommand,
      serve: spec?.agent.serve ?? DEFAULT_AGENT_SERVE,
      postStart: spec?.agent.serve?.postStartCommand,
    };

    const workspace = await provisionWorkspace(transport, plan, {
      step: (name, run) => logger.step(name, run),
      // Recorded first, so a sandbox whose setup fails is still deleted if the cleanup fails.
      created: (id) =>
        config.onProvisioned?.({ externalServiceId: sandboxHandle(this.name, id) }) ??
        Promise.resolve(),
    }).catch((error: unknown) => {
      throw userFacing(error, { label, machine, repoUrl: repo?.url, ref, port: plan.serve.port });
    });
    return {
      externalServiceId: sandboxHandle(this.name, workspace.id),
      upstreamUrl: workspace.preview.url,
      upstreamAccess: { headers: proxyRouteHeaders(workspace.preview.headers) },
      domain: this.getDomain(config.subdomain),
      serviceCreatedAt: workspace.startedAt ? new Date(workspace.startedAt) : new Date(),
      accessCredential: workspace.accessCredential,
    };
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

/** How the checkout is made: a fresh clone, or a refresh of a project snapshot's clone. */
function checkout(
  repo: NonNullable<NonNullable<WorkspaceConfig["provisioningSpec"]>["repo"]>,
  ref: string | undefined,
  snapshot: string | undefined,
): NonNullable<WorkspacePlan["checkout"]> {
  const url = repo.url.endsWith(".git") ? repo.url : `${repo.url}.git`;
  const inlineAuth = inlineGitAuthCommands(repo);
  const base = repo.baseCommit
    ? ` && GIT_TERMINAL_PROMPT=0 git fetch --depth 1 origin ${repo.baseCommit} && git checkout --detach ${repo.baseCommit}`
    : "";
  return {
    auth: inlineAuth?.configure ?? (repo.authToken ? GITHUB_APP_CREDENTIAL_HELPER : undefined),
    command: snapshot
      ? repositoryCheckoutCommand(repo, url)
      : `GIT_TERMINAL_PROMPT=0 git clone ${ref ? `--branch ${quote(ref)}` : ""} ${quote(url)} .${base}`,
  };
}

/** A failed step as a message the user can act on. */
function userFacing(
  error: unknown,
  context: {
    label: string;
    machine?: Record<string, unknown>;
    repoUrl?: string;
    ref?: string;
    port: number;
  },
): unknown {
  if (!(error instanceof WorkspaceSetupError)) return error;
  const { label, machine, repoUrl, ref, port } = context;
  switch (error.stage) {
    case "create": {
      const size = typeof machine?.size === "string" ? `a ${machine.size}` : "a";
      return new WorkspaceProvisionError(
        "SERVICE_UNAVAILABLE",
        `${label} couldn't start ${size} machine. ${error.output}`.trim(),
      );
    }
    case "install":
      return new WorkspaceProvisionError(
        "INTERNAL_SERVER_ERROR",
        `Installing the agent on ${label} failed: ${error.output}`,
      );
    case "clone":
      return new WorkspaceProvisionError(
        "BAD_REQUEST",
        `Couldn't clone ${repoUrl}${ref ? ` (branch ${ref})` : ""}: ${error.output} Check the URL and branch, and that Gitterm can access the repository.`,
      );
    case "before-agent":
      return new BeforeAgentSetupError(error.output);
    case "credential":
      return new Error("Failed to capture agent access credential");
    case "start":
      return new WorkspaceProvisionError(
        "INTERNAL_SERVER_ERROR",
        `The agent didn't start on port ${port}.${error.output ? ` Its log ends with:\n${error.output}` : ""}`,
      );
  }
}
