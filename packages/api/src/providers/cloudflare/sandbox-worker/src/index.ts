/**
 * GitTerm Cloudflare compute sandbox worker.
 *
 * This worker backs *normal* opencode workspaces (not the agent loop) running
 * on Cloudflare Sandboxes. A Cloudflare Sandbox is a Durable-Object-backed
 * Linux container. Container filesystem state is lost whenever the container
 * sleeps or is destroyed, but the Durable Object's storage survives. We exploit
 * that: the provisioning payload is persisted in DO storage so a stopped
 * workspace can be cheaply re-provisioned (repo re-clone + opencode restart) on
 * restart without GitTerm having to resend any secrets.
 *
 * Responsibilities:
 *   1. Control plane (`/__gitterm/*`, Bearer INTERNAL_API_KEY): provision,
 *      stop, restart, terminate and status for a sandbox.
 *   2. Data plane (everything else): proxy workspace HTTP/WS traffic that
 *      GitTerm forwards here to the right sandbox container port (opencode
 *      serve on 4096 by default). Routing is header based, so the worker can
 *      run on a plain `*.workers.dev` URL with no wildcard DNS.
 */
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

/**
 * Fallback port used only for proxying when GitTerm omits the port header
 * (it omits it when the agent's port matches this value). The agent server
 * itself is always started on the port supplied in the provisioning payload.
 */
const DEFAULT_PROXY_PORT = 4096;

/** Where repositories / the working tree live inside the container. */
const WORKSPACE_DIR = "/workspace";

/** Header names GitTerm injects when proxying workspace traffic. */
const HEADER_SANDBOX_ID = "x-gitterm-cf-sandbox-id";
const HEADER_INTERNAL_KEY = "x-gitterm-cf-internal-key";
const HEADER_PORT = "x-gitterm-cf-port";

/** DO storage key for the persisted provisioning payload. */
const PROVISION_STORAGE_KEY = "gitterm:provision";

interface Env {
  Sandbox: DurableObjectNamespace<GittermSandbox>;
  INTERNAL_API_KEY: string;
}

/** Repository to clone into the workspace. */
interface ProvisionRepo {
  url: string;
  branch?: string;
  name?: string;
  authUsername?: string;
  authToken?: string;
}

/**
 * Everything required to (re)build a workspace container from scratch. Stored
 * in DO storage so restarts can reconstruct the environment.
 */
interface ProvisionPayload {
  sandboxId: string;
  repo?: ProvisionRepo;
  opencodeConfigJson?: string;
  opencodeCredentialsJson?: string;
  serverPassword?: string;
  environmentVariables?: Record<string, string>;
  workspaceProfile?: string;
  /** Command that starts the agent server inside the sandbox (required). */
  startCommand: string;
  /** Port the agent server listens on (required). */
  port: number;
  /** Commands to run before starting the server (e.g. install the agent). */
  setupCommands?: string[];
}

interface BootResult {
  ready: boolean;
  repoDir: string;
  error?: string;
}

function repoDirFor(payload: ProvisionPayload): string {
  const name = payload.repo?.name?.trim();
  return name ? `${WORKSPACE_DIR}/${name}` : WORKSPACE_DIR;
}

function normalizeRepoUrl(url: string): string {
  return url.endsWith(".git") ? url : `${url}.git`;
}

/**
 * GitTerm-specific Sandbox. Adds provisioning + lifecycle RPC methods on top of
 * the base Cloudflare Sandbox so the worker can persist config and rebuild the
 * container on demand.
 */
export class GittermSandbox extends Sandbox<Env> {
  /** Persist the provisioning payload and build the workspace. */
  async gittermProvision(payload: ProvisionPayload): Promise<BootResult> {
    await this.ctx.storage.put(PROVISION_STORAGE_KEY, payload);
    return this.gittermBoot();
  }

  /** Rebuild the workspace from the persisted payload (used on restart). */
  async gittermBoot(): Promise<BootResult> {
    const payload = await this.ctx.storage.get<ProvisionPayload>(
      PROVISION_STORAGE_KEY,
    );

    if (!payload) {
      return {
        ready: false,
        repoDir: WORKSPACE_DIR,
        error: "No provisioning payload stored for this sandbox.",
      };
    }

    if (!payload.startCommand || !payload.port) {
      return {
        ready: false,
        repoDir: WORKSPACE_DIR,
        error: "Provisioning payload is missing startCommand/port.",
      };
    }

    const repoDir = repoDirFor(payload);

    try {
      if (payload.environmentVariables) {
        await this.setEnvVars(payload.environmentVariables);
      }

      await this.mkdir(WORKSPACE_DIR, { recursive: true });
      await this.writeOpencodeFiles(payload);
      await this.cloneRepo(payload, repoDir);
      await this.runSetupCommands(payload, repoDir);
      await this.startAgentServer(payload, repoDir);

      return { ready: true, repoDir };
    } catch (error) {
      return {
        ready: false,
        repoDir,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Report whether the agent server port is reachable. */
  async gittermStatus(): Promise<{ running: boolean }> {
    const payload = await this.ctx.storage.get<ProvisionPayload>(
      PROVISION_STORAGE_KEY,
    );
    const port = payload?.port ?? DEFAULT_PROXY_PORT;

    try {
      const response = await this.containerFetch(
        `http://localhost:${port}/`,
        {},
        port,
      );
      return { running: response.status < 500 };
    } catch {
      return { running: false };
    }
  }

  /**
   * Soft stop: kill running processes so the container can idle and sleep.
   * The DO storage (and thus the provisioning payload) is preserved, unlike
   * `destroy()`.
   */
  async gittermStop(): Promise<void> {
    await this.killAllProcesses().catch(() => undefined);
    await this.setKeepAlive(false).catch(() => undefined);
  }

  private async writeOpencodeFiles(payload: ProvisionPayload): Promise<void> {
    if (payload.opencodeConfigJson) {
      await this.mkdir("/root/.config/opencode", { recursive: true });
      await this.writeFile(
        "/root/.config/opencode/opencode.json",
        payload.opencodeConfigJson,
      );
    }

    if (payload.opencodeCredentialsJson) {
      await this.mkdir("/root/.local/share/opencode", { recursive: true });
      await this.writeFile(
        "/root/.local/share/opencode/auth.json",
        payload.opencodeCredentialsJson,
      );
    }
  }

  private async cloneRepo(
    payload: ProvisionPayload,
    repoDir: string,
  ): Promise<void> {
    const repo = payload.repo;

    if (!repo) {
      await this.mkdir(repoDir, { recursive: true });
      return;
    }

    // Commit as the authenticated GitHub user, not a generic bot identity.
    const githubUsername =
      payload.environmentVariables?.USER_GITHUB_USERNAME?.trim() ||
      repo.authUsername?.trim();

    // Configure git identity + credential helper so the agent can push.
    if (repo.authToken) {
      const helperPath = "/workspace/.git-credential-helper.sh";
      const credentialUsername =
        repo.authUsername || githubUsername || "x-access-token";
      await this.writeFile(
        helperPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "get" ]; then',
          '  echo "protocol=https"',
          '  echo "host=github.com"',
          `  echo "username=${credentialUsername}"`,
          `  echo "password=${repo.authToken}"`,
          "fi",
          "",
        ].join("\n"),
      );
      await this.exec(`chmod +x ${helperPath}`);
      await this.exec(`git config --global credential.helper '${helperPath}'`);
    }

    if (githubUsername) {
      // GitHub's privacy-preserving noreply address keeps commits attributed to
      // the user without exposing a real email.
      await this.exec(
        `git config --global user.name '${githubUsername.replace(/'/g, "")}'`,
      );
      await this.exec(
        `git config --global user.email '${githubUsername.replace(/'/g, "")}@users.noreply.github.com'`,
      );
    }

    const checkout = await this.gitCheckout(normalizeRepoUrl(repo.url), {
      branch: repo.branch,
      targetDir: repoDir,
    });

    if (!checkout.success) {
      throw new Error(
        `Failed to clone ${repo.url}${repo.branch ? ` (branch ${repo.branch})` : ""}`,
      );
    }
  }

  /** Run any agent-specific setup (e.g. installing the binary) before start. */
  private async runSetupCommands(
    payload: ProvisionPayload,
    repoDir: string,
  ): Promise<void> {
    for (const command of payload.setupCommands ?? []) {
      const result = await this.exec(command, { cwd: repoDir });
      if (result.exitCode !== 0) {
        throw new Error(
          `Setup command failed (exit ${result.exitCode}): ${command}`,
        );
      }
    }
  }

  /** Start the agent server and wait until its port is accepting connections. */
  private async startAgentServer(
    payload: ProvisionPayload,
    repoDir: string,
  ): Promise<void> {
    const passwordPrefix = payload.serverPassword
      ? `OPENCODE_SERVER_PASSWORD='${payload.serverPassword}' `
      : "";

    const proc = await this.startProcess(
      `${passwordPrefix}${payload.startCommand}`,
      { cwd: repoDir },
    );

    // Only report ready once the server is actually listening, so GitTerm's
    // "running" state is truthful (creation settlement is immediate).
    await proc.waitForPort(payload.port, { mode: "tcp", timeout: 60_000 });
  }
}

// The Sandbox Durable Object class must be exported from the worker entry.
export { GittermSandbox as Sandbox };

function unauthorized(): Response {
  return Response.json(
    { success: false, error: "Unauthorized" },
    { status: 401 },
  );
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("Authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
}

/** Handle GitTerm -> worker control-plane requests. */
async function handleControl(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (bearerToken(request) !== env.INTERNAL_API_KEY) {
    return unauthorized();
  }

  const body = (await request.json().catch(() => ({}))) as {
    sandboxId?: string;
  } & Partial<ProvisionPayload>;

  const sandboxId = body.sandboxId;
  if (!sandboxId) {
    return Response.json(
      { success: false, error: "Missing sandboxId" },
      { status: 400 },
    );
  }

  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  switch (path) {
    case "/__gitterm/provision": {
      const result = await sandbox.gittermProvision(body as ProvisionPayload);
      return Response.json(
        { success: result.ready, sandboxId, ...result },
        { status: result.ready ? 200 : 500 },
      );
    }

    case "/__gitterm/restart": {
      const result = await sandbox.gittermBoot();
      return Response.json(
        { success: result.ready, sandboxId, ...result },
        { status: result.ready ? 200 : 500 },
      );
    }

    case "/__gitterm/stop": {
      await sandbox.gittermStop();
      return Response.json({ success: true, sandboxId });
    }

    case "/__gitterm/terminate": {
      await sandbox.destroy().catch(() => undefined);
      return Response.json({ success: true, sandboxId });
    }

    case "/__gitterm/status": {
      const status = await sandbox.gittermStatus();
      return Response.json({ success: true, sandboxId, ...status });
    }

    default:
      return Response.json(
        { success: false, error: "Not found" },
        { status: 404 },
      );
  }
}

/** Proxy workspace traffic forwarded by GitTerm to the sandbox container. */
async function handleProxy(request: Request, env: Env): Promise<Response> {
  const sandboxId = request.headers.get(HEADER_SANDBOX_ID);
  const internalKey = request.headers.get(HEADER_INTERNAL_KEY);

  if (!sandboxId || internalKey !== env.INTERNAL_API_KEY) {
    return unauthorized();
  }

  const portHeader = request.headers.get(HEADER_PORT);
  const port = portHeader ? Number(portHeader) : DEFAULT_PROXY_PORT;

  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });

  try {
    return await sandbox.containerFetch(request, port);
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sandbox unreachable",
      },
      { status: 502 },
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/__gitterm/")) {
      if (request.method !== "POST") {
        return Response.json(
          { success: false, error: "Method not allowed" },
          { status: 405 },
        );
      }
      return handleControl(request, env, url.pathname);
    }

    return handleProxy(request, env);
  },
};
