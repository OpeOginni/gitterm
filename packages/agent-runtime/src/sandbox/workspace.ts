import {
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  shellQuote,
  type SandboxCreateInput,
  type SandboxPreviewAccess,
  type SandboxTransport,
} from "./types";

/**
 * Agent workspaces on any sandbox transport: the steps that turn a plain sandbox into a
 * running agent with a checkout. The Gitterm server's workspace provider and the SDK's
 * direct workspaces both use them, so a provider only implements its transport.
 */

/** A file the agent needs. `~/` is the sandbox user's `$HOME`. */
export type WorkspaceFile = {
  path: string;
  contentBase64: string;
  mode?: number;
  /** Below the checkout rather than an absolute or `~/` path. */
  relativeToRepo?: boolean;
};

export type WorkspacePlan = {
  /** Creates the sandbox. The resume command is added here. */
  create: Omit<SandboxCreateInput, "resumeCommand">;
  /** Use this existing sandbox instead of creating one; it is never deleted on failure. */
  existingId?: string;
  /** Installs the agent on a plain image. Skipped when starting from a snapshot. */
  setupCommands?: string[];
  /** The checkout's directory name below the provider's workspace root. */
  name: string;
  checkout?: {
    /** Run first, from the home directory, e.g. to configure git credentials. */
    auth?: string;
    /** Clones (or, from a snapshot, refreshes) the repository, run in the checkout directory. */
    command: string;
  };
  files: WorkspaceFile[];
  /** Blocking setup run in the checkout before the agent starts. */
  beforeAgent?: string;
  /** Run before the agent starts; its trimmed output is the agent's access credential. */
  accessCredentialCommand?: string;
  serve: { command: string; port: number };
  /** Started detached once the agent answers. */
  postStart?: string;
};

export type WorkspaceSetupStage =
  | "create"
  | "install"
  | "clone"
  | "before-agent"
  | "credential"
  | "start";

/** A step that failed, with the end of its output (never a credential's). */
export class WorkspaceSetupError extends Error {
  constructor(
    readonly stage: WorkspaceSetupStage,
    readonly output: string,
  ) {
    super(`Workspace ${stage} failed${output ? `: ${output}` : ""}`);
    this.name = "WorkspaceSetupError";
  }
}

export type WorkspaceSetupHooks = {
  /** Wraps each step, e.g. to log its timing. */
  step?: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  /** Called with the sandbox's id as soon as it exists, before any setup, even if creating it failed. */
  created?: (id: string) => Promise<void>;
};

export type ProvisionedWorkspace = {
  id: string;
  /** The checkout, where the agent runs. */
  directory: string;
  preview: SandboxPreviewAccess;
  accessCredential?: string;
  startedAt: string | null;
};

/** The agent's start command, kept in the sandbox user's home for resumes. */
const RESUME_SCRIPT = '"$HOME/.gitterm/resume.sh"';
/** Process group of the running agent, so a workspace on a borrowed sandbox can stop it. */
const AGENT_PID = '"$HOME/.gitterm/agent.pid"';
/** The label that keeps the agent's port, to find its new URL after a resume. */
export const AGENT_PORT_LABEL = "gitterm_agent_port";

/** The directory that holds a provider's checkouts. */
export function workspaceDirectory(transport: SandboxTransport, name: string): string {
  return `${SANDBOX_PROVIDER_PROFILES[transport.provider].workspaceRoot}/${name}`;
}

/** The end of a command's output: git and friends put the reason last. */
export function lastLines(text: string): string {
  return text.trim().split("\n").slice(-3).join(" ").slice(-500);
}

/** Starts the agent once: a resume runs this again, so it does nothing when the port answers. */
export function startAgentCommand(serve: { command: string; port: number }, directory: string) {
  const answers = `bash -c ${shellQuote(`exec 3<>/dev/tcp/127.0.0.1/${serve.port}`)} 2>/dev/null`;
  const start = `nohup setsid bash -lc ${shellQuote(serve.command)} > /tmp/agent-server.log 2>&1 </dev/null & echo $! > ${AGENT_PID}`;
  // Running means the agent answers, so wait for its port (resume runs this as well).
  const wait = `i=0; until ${answers}; do i=$((i+1)); [ $i -lt 50 ] || { echo "The agent did not open port ${serve.port}; see /tmp/agent-server.log" >&2; exit 1; }; sleep 1; done`;
  return `cd ${shellQuote(directory)} && mkdir -p "$HOME/.gitterm" && { ${answers} || { ${start}; }; } && { ${wait}; }`;
}

async function must(
  transport: SandboxTransport,
  id: string,
  stage: WorkspaceSetupStage,
  command: string,
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const result = await transport.run(id, command, { timeoutMs: 60_000, ...options });
  if (result.exitCode !== 0)
    throw new WorkspaceSetupError(stage, lastLines(result.stderr || result.stdout));
  return result.stdout;
}

/**
 * Creates the sandbox and sets up the agent: install it, check out the repository, write
 * its files, run the setup, and start it. Deletes a sandbox it created if a step fails.
 */
export async function provisionWorkspace(
  transport: SandboxTransport,
  plan: WorkspacePlan,
  hooks: WorkspaceSetupHooks = {},
): Promise<ProvisionedWorkspace> {
  const step = hooks.step ?? (<T>(_name: string, run: () => Promise<T>) => run());
  const profile = SANDBOX_PROVIDER_PROFILES[transport.provider];
  const directory = workspaceDirectory(transport, plan.name);
  const resume = startAgentCommand(plan.serve, directory);

  let id = plan.existingId;
  let startedAt: string | null = null;
  if (!id) {
    const created = await step("create-sandbox", () =>
      transport
        .create({
          ...plan.create,
          labels: { ...plan.create.labels, [AGENT_PORT_LABEL]: String(plan.serve.port) },
          ...(profile.resumeCommand ? { resumeCommand: resume } : {}),
        })
        .catch(async (error: unknown) => {
          // The provider made a sandbox it couldn't delete: record it so the caller deletes it.
          if (error instanceof SandboxProviderError && error.leftoverId)
            await hooks.created?.(error.leftoverId);
          throw new WorkspaceSetupError(
            "create",
            error instanceof Error ? error.message : String(error),
          );
        }),
    );
    id = created.id;
    startedAt = created.startedAt;
  }
  const sandbox = id;

  try {
    await hooks.created?.(sandbox);
    const home =
      (await must(transport, sandbox, "create", 'printf %s "$HOME"')).trim() || transport.home;
    if (!plan.create.snapshot) {
      for (const command of plan.setupCommands ?? [])
        await step("install-agent", () =>
          must(transport, sandbox, "install", command, { timeoutMs: 600_000 }),
        );
    }
    await step("create-workspace-directory", () =>
      must(transport, sandbox, "create", `mkdir -p ${shellQuote(directory)}`),
    );
    if (plan.checkout) {
      const { auth, command } = plan.checkout;
      if (auth) await step("configure-git-auth", () => must(transport, sandbox, "clone", auth));
      await step("clone-repository", () =>
        must(transport, sandbox, "clone", command, { cwd: directory, timeoutMs: 600_000 }),
      );
    }
    await step("write-agent-files", () =>
      writeFiles(transport, sandbox, plan.files, directory, home),
    );
    if (!profile.resumeCommand) {
      await step("write-resume-script", () =>
        must(
          transport,
          sandbox,
          "start",
          `mkdir -p "$HOME/.gitterm" && printf %s ${shellQuote(Buffer.from(`${resume}\n`).toString("base64"))} | base64 -d > ${RESUME_SCRIPT}`,
        ),
      );
    }
    if (plan.beforeAgent) {
      const command = plan.beforeAgent;
      await step("before-agent-setup", () =>
        must(transport, sandbox, "before-agent", command, {
          cwd: directory,
          timeoutMs: 600_000,
        }),
      );
    }
    const accessCredential = plan.accessCredentialCommand
      ? await step("capture-access-credential", () =>
          captureCredential(transport, sandbox, plan.accessCredentialCommand!, directory),
        )
      : undefined;
    await step("start-agent-server", async () => {
      const result = await transport.run(sandbox, resume, { timeoutMs: 120_000 });
      if (result.exitCode === 0) return;
      const log = await transport
        .run(sandbox, "tail -c 1500 /tmp/agent-server.log", { timeoutMs: 10_000 })
        .then((tail) => tail.stdout.trim())
        .catch(() => "");
      throw new WorkspaceSetupError("start", log);
    });
    if (plan.postStart) {
      const command = plan.postStart;
      await step("run-post-start-command", () =>
        transport.run(
          sandbox,
          `nohup setsid bash -lc ${shellQuote(command)} > /tmp/agent-post-start.log 2>&1 </dev/null &`,
          { cwd: directory },
        ),
      );
    }
    const preview = await step("open-agent-port", () =>
      transport.preview(sandbox, plan.serve.port),
    );
    return { id: sandbox, directory, preview, accessCredential, startedAt };
  } catch (error) {
    if (!plan.existingId) await transport.destroy(sandbox).catch(() => undefined);
    else await stopAgent(transport, sandbox).catch(() => undefined);
    throw error;
  }
}

async function writeFiles(
  transport: SandboxTransport,
  id: string,
  files: WorkspaceFile[],
  directory: string,
  home: string,
) {
  for (const file of files) {
    const path = file.relativeToRepo
      ? `${directory}/${file.path}`
      : file.path.startsWith("~/")
        ? `${home}/${file.path.slice(2)}`
        : file.path;
    const dir = path.slice(0, path.lastIndexOf("/")) || "/";
    const chmod = file.mode == null ? "" : `chmod ${file.mode.toString(8)} ${shellQuote(path)}`;
    // Runtime secrets like /run/gitterm/... live outside the user's home: create a
    // user-owned directory with sudo, as commands run as the sandbox user.
    if (!path.startsWith(`${home}/`) && !path.startsWith("/tmp/")) {
      await must(
        transport,
        id,
        "create",
        `sudo -n mkdir -p ${shellQuote(dir)} && sudo -n chown "$(id -u):$(id -g)" ${shellQuote(dir)} && chmod 700 ${shellQuote(dir)} && printf %s '${file.contentBase64}' | base64 -d > ${shellQuote(path)}${chmod ? ` && ${chmod}` : ""}`,
      );
      continue;
    }
    await must(transport, id, "create", `mkdir -p ${shellQuote(dir)}`);
    await transport.writeFile(id, path, Buffer.from(file.contentBase64, "base64"));
    if (chmod) await must(transport, id, "create", chmod);
  }
}

/** Never puts the command's output in an error: it may hold the credential. */
async function captureCredential(
  transport: SandboxTransport,
  id: string,
  command: string,
  directory: string,
): Promise<string> {
  const result = await transport.run(id, command, { cwd: directory }).catch(() => null);
  const credential = result?.exitCode === 0 ? result.stdout.trim() : "";
  if (!credential) throw new WorkspaceSetupError("credential", "");
  return credential;
}

/**
 * After a resume: starts the agent again on transports that don't run a resume command
 * themselves, and returns the agent's new preview where a resume changes it (Vercel). Plain
 * sandboxes have no script and no agent port, so this does nothing for them.
 */
export async function afterResume(
  transport: SandboxTransport,
  id: string,
): Promise<SandboxPreviewAccess | undefined> {
  const profile = SANDBOX_PROVIDER_PROFILES[transport.provider];
  if (!profile.resumeCommand) {
    const result = await transport.run(id, `[ ! -f ${RESUME_SCRIPT} ] || bash ${RESUME_SCRIPT}`, {
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0)
      throw new WorkspaceSetupError("start", lastLines(result.stderr || result.stdout));
  }
  if (!profile.resumeChangesPreviewUrls) return undefined;
  const port = Number((await transport.info(id)).labels[AGENT_PORT_LABEL]);
  return port ? transport.preview(id, port) : undefined;
}

/** Stops the agent and its children, for a workspace on a sandbox it doesn't own. */
export async function stopAgent(transport: SandboxTransport, id: string): Promise<void> {
  await transport.run(
    id,
    `[ ! -f ${AGENT_PID} ] || { kill -- -"$(cat ${AGENT_PID})" 2>/dev/null; rm -f ${AGENT_PID}; }`,
  );
}
