import type { SandboxProviderState, SandboxTransport } from "@gitterm/agent-runtime/sandbox/types";
import {
  afterResume,
  provisionWorkspace,
  stopAgent,
  WorkspaceSetupError,
} from "@gitterm/agent-runtime/sandbox/workspace";
import {
  cloneRepositoryScript,
  DIRECT_OPENCODE_PORT,
  setupCommandScript,
  waitForDirectRuntime,
} from "./provisioning.js";
import type {
  DirectProviderAdapter,
  DirectProviderCapabilities,
  DirectProviderWorkspaceInput,
  DirectWorkspace,
  DirectWorkspaceRuntime,
  DirectWorkspaceStatus,
} from "./types.js";

/** Marks a workspace on a sandbox the caller brought: terminating it only stops the agent. */
const EXISTING = "existing:";

export type TransportDirectProviderOptions = {
  name: string;
  capabilities: DirectProviderCapabilities;
  transport: SandboxTransport;
  /** The image or template with the agent, when the provider's default lacks it. */
  template?: () => Promise<string | undefined>;
  /** The transport's machine options. */
  machine?: Record<string, unknown>;
  /** The sandbox's lifetime, or idle time for persistent workspaces. */
  timeoutMs: number;
  /** Install the agent on the image; skipped when the template has it. */
  setupCommands?: string[];
  /** An existing sandbox to use instead of creating one. */
  existing?: (input: DirectProviderWorkspaceInput) => string | undefined;
};

const STATUS: Record<SandboxProviderState, DirectWorkspaceStatus> = {
  pending: "pending",
  running: "running",
  paused: "paused",
  terminated: "terminated",
};

/**
 * A direct workspace on any sandbox transport. The provider runs the same setup steps as
 * Gitterm's server does (`@gitterm/agent-runtime/sandbox/workspace`), with the caller's own
 * provider credentials.
 */
export function createTransportDirectProvider(
  options: TransportDirectProviderOptions,
): DirectProviderAdapter {
  const { transport } = options;
  const parse = (externalId: string) =>
    externalId.startsWith(EXISTING)
      ? { id: externalId.slice(EXISTING.length), existing: true }
      : { id: externalId, existing: false };

  const runtimeFor = (
    preview: { url: string; headers: Record<string, string> },
    directory: string,
    password?: string,
  ): DirectWorkspaceRuntime => ({
    url: preview.url,
    directory,
    ...(Object.keys(preview.headers).length ? { headers: preview.headers } : {}),
    ...(password ? { password } : {}),
  });

  const terminate = async (externalId: string) => {
    const { id, existing } = parse(externalId);
    if (existing) await stopAgent(transport, id);
    else await transport.destroy(id);
  };

  return {
    name: options.name,
    capabilities: options.capabilities,

    async create(input) {
      const plan = input.provisioning;
      const existingId = options.existing?.(input);
      const workspace = await provisionWorkspace(transport, {
        create: {
          labels: { gitterm_workspace: input.id },
          timeoutMs: options.timeoutMs,
          onTimeout: input.lifecycle === "persistent" ? "pause" : "kill",
          template: await options.template?.(),
          ...(options.machine ? { machine: options.machine } : {}),
          env: plan.agent.environmentVariables,
        },
        ...(existingId ? { existingId } : {}),
        setupCommands: options.setupCommands,
        name: plan.repository?.name ?? "workspace",
        ...(plan.repository
          ? { checkout: { command: cloneRepositoryScript(plan.repository, ".") } }
          : {}),
        files: plan.agent.files,
        ...(plan.setup.beforeAgent.length
          ? { beforeAgent: setupCommandScript(plan.setup.beforeAgent) }
          : {}),
        serve: { command: plan.agent.command, port: plan.agent.port },
      }).catch((error: unknown) => {
        throw error instanceof WorkspaceSetupError
          ? new Error(`${options.name} workspace ${error.stage} failed: ${error.output}`, {
              cause: error,
            })
          : error;
      });
      const externalId = existingId ? `${EXISTING}${workspace.id}` : workspace.id;
      const runtime = runtimeFor(workspace.preview, workspace.directory, input.password);
      try {
        await waitForDirectRuntime(runtime);
      } catch (error) {
        await terminate(externalId).catch(() => undefined);
        throw error;
      }
      return { externalId, runtime };
    },

    async status(workspace) {
      return STATUS[(await transport.info(parse(workspace.externalId).id)).state];
    },

    async pause(workspace) {
      await transport.pause(parse(workspace.externalId).id);
    },

    async resume(workspace) {
      const { id } = parse(workspace.externalId);
      await transport.resume(id);
      const preview =
        (await afterResume(transport, id)) ?? (await transport.preview(id, DIRECT_OPENCODE_PORT));
      const runtime = runtimeFor(preview, workspace.runtime.directory, workspace.runtime.password);
      await waitForDirectRuntime(runtime);
      return runtime;
    },

    async terminate(workspace) {
      await terminate(workspace.externalId);
    },

    ...(transport.keepAlive
      ? {
          async keepAlive(workspace: DirectWorkspace, timeoutMs: number) {
            await transport.keepAlive!(parse(workspace.externalId).id, timeoutMs);
          },
        }
      : {}),
  };
}
