import { randomUUID } from "node:crypto";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { directError, directRunOperations, directRuntime } from "./runs.js";
import { aborted, terminal } from "../runs.js";
import { GittermError } from "../errors.js";
import { createRuntimeHttp, RuntimeHttpError } from "@gitterm/agent-runtime/http";
import {
  createOpencodeClient as createOpencodeV2Client,
  type IntegrationAttemptStatus,
} from "@opencode-ai/sdk/v2";
import { createAsciiDirectProvider } from "./ascii.js";
import { createDaytonaDirectProvider } from "./daytona.js";
import { createE2BDirectProvider } from "./e2b.js";
import { createExeDevDirectProvider } from "./exedev.js";
import {
  buildDirectProvisioningPlan,
  directModelAuth,
  setupCommandScript,
  shellQuote,
} from "./provisioning.js";
import { createRailwayDirectProvider } from "./railway.js";
import { createVercelDirectProvider } from "./vercel.js";
import type {
  DirectProviderAdapter,
  DirectProviderConfig,
  DirectAuthAttempt,
  DirectAuthAttemptStatus,
  DirectAuthIntegration,
  DirectAuthWaitOptions,
  DirectModelCredential,
  DirectRun,
  DirectRunCreateInput,
  DirectWorkspace,
  DirectWorkspaceCreateInput,
  DirectWorkspaceSetupStatus,
  DirectWorkspaceSetupWaitOptions,
} from "./types.js";

const SETUP_DIR = ".gitterm/setup";

export type DirectGittermClientOptions = {
  provider: DirectProviderAdapter | DirectProviderConfig;
  /** Used for OpenCode runtime requests (provider adapters own their own transports). */
  fetch?: typeof fetch;
};

function resolveProvider(provider: DirectGittermClientOptions["provider"]): DirectProviderAdapter {
  if ("create" in provider) return provider;
  switch (provider.type) {
    case "ascii":
      return createAsciiDirectProvider(provider);
    case "daytona":
      return createDaytonaDirectProvider(provider);
    case "e2b":
      return createE2BDirectProvider(provider);
    case "exedev":
      return createExeDevDirectProvider(provider);
    case "railway":
      return createRailwayDirectProvider(provider);
    case "vercel":
      return createVercelDirectProvider(provider);
  }
}

function runtimeClient(workspace: DirectWorkspace, fetchImpl?: typeof fetch) {
  const authorization = workspace.runtime.password
    ? `Basic ${Buffer.from(`opencode:${workspace.runtime.password}`).toString("base64")}`
    : undefined;
  return createOpencodeClient({
    fetch: fetchImpl,
    baseUrl: workspace.runtime.url,
    directory: workspace.runtime.directory,
    headers: {
      ...workspace.runtime.headers,
      ...(authorization ? { Authorization: authorization } : {}),
    },
  });
}

function createAuthClient(workspace: DirectWorkspace, fetchImpl?: typeof fetch) {
  if (workspace.opencodeApi !== "v2")
    throw new GittermError(
      "BAD_REQUEST",
      "Runtime OAuth connection management requires OpenCode v2; use inline credentials or a managed workspace with v1",
    );
  const authorization = workspace.runtime.password
    ? `Basic ${Buffer.from(`opencode:${workspace.runtime.password}`).toString("base64")}`
    : undefined;
  return createOpencodeV2Client({
    fetch: fetchImpl,
    baseUrl: workspace.runtime.url,
    directory: workspace.runtime.directory,
    headers: {
      ...workspace.runtime.headers,
      ...(authorization ? { Authorization: authorization } : {}),
    },
  });
}

function errorMessage(error: unknown): string {
  if (!error) return "OpenCode request failed";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: unknown } }).data;
    if (typeof data?.message === "string") return data.message;
  }
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : JSON.stringify(error);
}

function authStatus(status: IntegrationAttemptStatus): DirectAuthAttemptStatus {
  const common = {
    createdAt: Number(status.time.created),
    expiresAt: Number(status.time.expires),
  };
  if (status.status === "failed") return { status: "failed", message: status.message, ...common };
  return { status: status.status, ...common };
}

function pollTiming(
  wait: { timeoutMs?: number; pollIntervalMs?: number },
  fallbackTimeoutMs: number,
) {
  const timeoutMs = wait.timeoutMs ?? fallbackTimeoutMs;
  const pollIntervalMs = wait.pollIntervalMs ?? 1_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("timeoutMs must be a finite, non-negative number");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error("pollIntervalMs must be a finite, non-negative number");
  }
  return { timeoutMs, pollIntervalMs };
}

function validateEnvironmentVariables(values: Record<string, string>): Record<string, string> {
  for (const key of Object.keys(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    if (
      key === "OPENCODE_SERVER_PASSWORD" ||
      key === "OPENCODE_SERVER_USERNAME" ||
      key === "GITTERM_DIRECT_PROVIDER"
    ) {
      throw new Error(`Environment variable ${key} is managed by Gitterm`);
    }
  }
  return values;
}

function setupRunner(commands: string[]): string {
  const body = Buffer.from(setupCommandScript(commands)).toString("base64");
  return [
    "set -u",
    `SETUP_DIR=${shellQuote(SETUP_DIR)}`,
    'mkdir -p "$SETUP_DIR"',
    'if [ -d .git/info ]; then grep -qxF "/.gitterm/" .git/info/exclude 2>/dev/null || printf "/.gitterm/\\n" >> .git/info/exclude; fi',
    'printf "waiting\\n" > "$SETUP_DIR/state"',
    `printf %s ${shellQuote(body)} | base64 -d > "$SETUP_DIR/script.sh"`,
    'chmod 700 "$SETUP_DIR/script.sh"',
    'date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/started-at"',
    'printf "running\\n" > "$SETUP_DIR/state"',
    'bash -e "$SETUP_DIR/script.sh" > "$SETUP_DIR/setup.log" 2>&1',
    "code=$?",
    'printf "%s\\n" "$code" > "$SETUP_DIR/exit-code"',
    'date -u +%Y-%m-%dT%H:%M:%SZ > "$SETUP_DIR/finished-at"',
    'if [ "$code" -eq 0 ]; then printf "succeeded\\n" > "$SETUP_DIR/state"; else printf "failed\\n" > "$SETUP_DIR/state"; fi',
    "exit $code",
  ].join("\n");
}

export function createDirectGittermClient(options: DirectGittermClientOptions) {
  const provider = resolveProvider(options.provider);
  const authClient = (workspace: DirectWorkspace) => createAuthClient(workspace, options.fetch);
  const http = (workspace: DirectWorkspace) =>
    createRuntimeHttp({
      url: workspace.runtime.url,
      directory: workspace.runtime.directory,
      password: workspace.runtime.password ?? null,
      api: workspace.opencodeApi,
      headers: workspace.runtime.headers,
      fetch: options.fetch,
    });

  function assertWorkspace(workspace: DirectWorkspace) {
    if (workspace.provider !== provider.name) {
      throw new GittermError(
        "BAD_REQUEST",
        `Workspace belongs to ${workspace.provider}, not ${provider.name}`,
      );
    }
  }

  function assertAuthAttempt(attempt: DirectAuthAttempt, workspace: DirectWorkspace) {
    assertWorkspace(workspace);
    if (attempt.workspaceId !== workspace.id) {
      throw new Error(
        `OAuth attempt belongs to workspace ${attempt.workspaceId}, not ${workspace.id}`,
      );
    }
  }

  async function getAuthStatus(
    attempt: DirectAuthAttempt,
    workspace: DirectWorkspace,
  ): Promise<DirectAuthAttemptStatus> {
    assertAuthAttempt(attempt, workspace);
    const result = await authClient(workspace).v2.integration.attempt.status({
      attemptID: attempt.id,
    });
    if (result.error || !result.data) throw new Error(errorMessage(result.error));
    return authStatus(result.data.data);
  }

  async function startPty(workspace: DirectWorkspace, command: string, title: string) {
    const result = await http(workspace).json(
      workspace.opencodeApi === "v2"
        ? "/api/pty"
        : `/pty?directory=${encodeURIComponent(workspace.runtime.directory)}`,
      {
        method: "POST",
        json: { command: "bash", args: ["-lc", command], cwd: workspace.runtime.directory, title },
      },
    );
    return result;
  }

  async function setupFile(workspace: DirectWorkspace, name: string): Promise<string | null> {
    try {
      if (workspace.opencodeApi === "v2") {
        return (
          await (await http(workspace).send(`/api/fs/read/${SETUP_DIR}/${name}`)).text()
        ).trim();
      }
      const result = await runtimeClient(workspace, options.fetch).file.read({
        query: { directory: workspace.runtime.directory, path: `${SETUP_DIR}/${name}` },
      });
      if (result.error || !result.data || result.data.type !== "text") return null;
      return result.data.content.trim();
    } catch (error) {
      if (error instanceof RuntimeHttpError && error.status === 404) return null;
      throw directError(error);
    }
  }

  async function getSetupStatus(workspace: DirectWorkspace): Promise<DirectWorkspaceSetupStatus> {
    assertWorkspace(workspace);
    if (workspace.setup === "not_requested") {
      return {
        status: "not_requested",
        exitCode: null,
        startedAt: null,
        finishedAt: null,
        log: null,
      };
    }
    if (workspace.setup === "before_agent_complete") {
      return {
        status: "succeeded",
        exitCode: 0,
        startedAt: null,
        finishedAt: null,
        log: null,
      };
    }
    const [state, exitCode, startedAt, finishedAt, log] = await Promise.all([
      setupFile(workspace, "state"),
      setupFile(workspace, "exit-code"),
      setupFile(workspace, "started-at"),
      setupFile(workspace, "finished-at"),
      setupFile(workspace, "setup.log"),
    ]);
    const status = ["waiting", "running", "succeeded", "failed"].includes(state ?? "")
      ? (state as DirectWorkspaceSetupStatus["status"])
      : "waiting";
    return {
      status,
      exitCode: exitCode != null && Number.isInteger(Number(exitCode)) ? Number(exitCode) : null,
      startedAt,
      finishedAt,
      log: log?.slice(-50_000) ?? null,
    };
  }

  return {
    provider: { name: provider.name, capabilities: provider.capabilities },
    auth: {
      async setCredential(
        workspace: DirectWorkspace,
        credential: DirectModelCredential,
      ): Promise<void> {
        assertWorkspace(workspace);
        const providerName = credential.providerName.trim();
        if (!providerName) {
          throw new Error("Model credential providerName is required");
        }
        if (workspace.opencodeApi === "v2") {
          if (credential.source !== "apiKey")
            throw new GittermError(
              "BAD_REQUEST",
              "Use connectOAuth() for v2 credential rotation, or inject an OAuth bundle when creating the workspace",
            );
          directModelAuth(credential);
          await http(workspace).send(
            `/api/integration/${encodeURIComponent(providerName)}/connect/key`,
            { method: "POST", json: { key: credential.apiKey } },
          );
          return;
        }
        const result = await runtimeClient(workspace, options.fetch).auth.set({
          path: { id: providerName },
          query: { directory: workspace.runtime.directory },
          body: directModelAuth(credential),
        });
        if (result.error) throw new Error(errorMessage(result.error));
      },
      async list(workspace: DirectWorkspace): Promise<DirectAuthIntegration[]> {
        assertWorkspace(workspace);
        const result = await authClient(workspace).v2.integration.list();
        if (result.error || !result.data) throw new Error(errorMessage(result.error));
        return result.data.data;
      },
      async get(workspace: DirectWorkspace, integrationId: string): Promise<DirectAuthIntegration> {
        assertWorkspace(workspace);
        const result = await authClient(workspace).v2.integration.get({
          integrationID: integrationId,
        });
        if (result.error || !result.data) throw new Error(errorMessage(result.error));
        return result.data.data;
      },
      async connectKey(input: {
        workspace: DirectWorkspace;
        integrationId: string;
        key: string;
        label?: string;
      }): Promise<void> {
        assertWorkspace(input.workspace);
        const result = await authClient(input.workspace).v2.integration.connect.key({
          integrationID: input.integrationId,
          key: input.key,
          label: input.label,
        });
        if (result.error) throw new Error(errorMessage(result.error));
      },
      async connectOAuth(input: {
        workspace: DirectWorkspace;
        integrationId: string;
        methodId: string;
        inputs?: Record<string, string>;
        label?: string;
      }): Promise<DirectAuthAttempt> {
        assertWorkspace(input.workspace);
        const result = await authClient(input.workspace).v2.integration.connect.oauth({
          integrationID: input.integrationId,
          methodID: input.methodId,
          inputs: input.inputs ?? {},
          label: input.label,
        });
        if (result.error || !result.data) throw new Error(errorMessage(result.error));
        const attempt = result.data.data;
        return {
          id: attempt.attemptID,
          workspaceId: input.workspace.id,
          integrationId: input.integrationId,
          url: attempt.url,
          instructions: attempt.instructions,
          mode: attempt.mode,
          createdAt: Number(attempt.time.created),
          expiresAt: Number(attempt.time.expires),
        };
      },
      async status(
        attempt: DirectAuthAttempt,
        workspace: DirectWorkspace,
      ): Promise<DirectAuthAttemptStatus> {
        return getAuthStatus(attempt, workspace);
      },
      async complete(
        attempt: DirectAuthAttempt,
        workspace: DirectWorkspace,
        code: string,
      ): Promise<void> {
        assertAuthAttempt(attempt, workspace);
        if (attempt.mode !== "code")
          throw new Error("Only code-based OAuth attempts are completed manually");
        if (!code.trim()) throw new Error("OAuth authorization code is required");
        const result = await authClient(workspace).v2.integration.attempt.complete({
          attemptID: attempt.id,
          code,
        });
        if (result.error) throw new Error(errorMessage(result.error));
      },
      async wait(
        attempt: DirectAuthAttempt,
        workspace: DirectWorkspace,
        wait: DirectAuthWaitOptions = {},
      ): Promise<DirectAuthAttemptStatus> {
        assertAuthAttempt(attempt, workspace);
        const { timeoutMs, pollIntervalMs } = pollTiming(
          wait,
          Math.max(0, attempt.expiresAt - Date.now()),
        );
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
          const status = await getAuthStatus(attempt, workspace);
          if (status.status === "complete") return status;
          if (status.status === "failed") throw new Error(status.message);
          if (status.status === "expired") throw new Error("OAuth attempt expired");
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
        }
        throw new Error(`OAuth attempt timed out after ${timeoutMs}ms`);
      },
      async cancel(attempt: DirectAuthAttempt, workspace: DirectWorkspace): Promise<void> {
        assertAuthAttempt(attempt, workspace);
        const result = await authClient(workspace).v2.integration.attempt.cancel({
          attemptID: attempt.id,
        });
        if (result.error) throw new Error(errorMessage(result.error));
      },
    },
    workspaces: {
      async create(input: DirectWorkspaceCreateInput = {}): Promise<DirectWorkspace> {
        if (input.opencode?.api && !["v1", "v2"].includes(input.opencode.api))
          throw new GittermError("BAD_REQUEST", "opencode.api must be v1 or v2");
        const lifecycle = input.lifecycle ?? provider.capabilities.recommendedLifecycle;
        if (lifecycle === "persistent" && provider.capabilities.persistence === "unsupported") {
          throw new Error(`${provider.name} does not support persistent direct workspaces`);
        }
        const id = input.id ?? randomUUID();
        const password = randomUUID();
        validateEnvironmentVariables(input.environmentVariables ?? {});
        const provisioning = buildDirectProvisioningPlan({ ...input, id, lifecycle, password });
        const created = await provider.create({ ...input, id, lifecycle, password, provisioning });
        const workspace: DirectWorkspace = {
          id,
          provider: provider.name,
          externalId: created.externalId,
          status: "running",
          lifecycle,
          runtime: created.runtime,
          opencodeApi: input.opencode?.api ?? "v1",
          setup: provisioning.setup.afterAgent.length
            ? "after_agent"
            : provisioning.setup.beforeAgent.length
              ? "before_agent_complete"
              : "not_requested",
          createdAt: new Date().toISOString(),
        };
        if (provisioning.setup.afterAgent.length) {
          try {
            await startPty(workspace, setupRunner(provisioning.setup.afterAgent), "Gitterm setup");
          } catch (error) {
            await provider.terminate(workspace).catch(() => undefined);
            throw error;
          }
        }
        return workspace;
      },
      async status(workspace: DirectWorkspace): Promise<DirectWorkspace> {
        assertWorkspace(workspace);
        return { ...workspace, status: await provider.status(workspace) };
      },
      async pause(workspace: DirectWorkspace): Promise<DirectWorkspace> {
        assertWorkspace(workspace);
        if (!provider.pause) throw new Error(`${provider.name} does not support pause`);
        if (
          workspace.lifecycle === "ephemeral" &&
          provider.capabilities.ephemeralPause !== "stateful"
        ) {
          throw new Error(
            `${provider.name} cannot pause an ephemeral workspace without losing state`,
          );
        }
        await provider.pause(workspace);
        return { ...workspace, status: "paused" };
      },
      async resume(workspace: DirectWorkspace): Promise<DirectWorkspace> {
        assertWorkspace(workspace);
        if (!provider.resume) throw new Error(`${provider.name} does not support resume`);
        const runtime = await provider.resume(workspace);
        return {
          ...workspace,
          status: "running",
          runtime: { ...workspace.runtime, ...runtime },
        };
      },
      async terminate(workspace: DirectWorkspace): Promise<DirectWorkspace> {
        assertWorkspace(workspace);
        await provider.terminate(workspace);
        return { ...workspace, status: "terminated" };
      },
      async keepAlive(workspace: DirectWorkspace, timeoutMs: number): Promise<void> {
        assertWorkspace(workspace);
        if (!provider.keepAlive) throw new Error(`${provider.name} does not support keep-alive`);
        await provider.keepAlive(workspace, timeoutMs);
      },
      setupStatus: getSetupStatus,
      async waitForSetup(
        workspace: DirectWorkspace,
        wait: DirectWorkspaceSetupWaitOptions = {},
      ): Promise<DirectWorkspaceSetupStatus> {
        const { timeoutMs, pollIntervalMs } = pollTiming(wait, 10 * 60_000);
        const deadline = Date.now() + timeoutMs;
        while (true) {
          const status = await getSetupStatus(workspace);
          if (status.status === "not_requested" || status.status === "succeeded") return status;
          if (status.status === "failed") {
            throw new Error(
              `Workspace setup failed${status.exitCode == null ? "" : ` with exit code ${status.exitCode}`}${status.log ? `\n${status.log}` : ""}`,
            );
          }
          if (Date.now() >= deadline) {
            throw new Error(`Workspace setup timed out after ${timeoutMs}ms`);
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      },
    },
    runs: {
      ...directRunOperations(assertWorkspace, options.fetch),
      async create(input: DirectRunCreateInput): Promise<DirectRun> {
        assertWorkspace(input.workspace);
        aborted(input.signal);
        if (input.workspace.status !== "running")
          throw new GittermError(
            "WORKSPACE_NOT_RUNNING",
            "Resume the workspace before creating a run",
          );
        if (!input.prompt.trim()) throw new GittermError("BAD_REQUEST", "Prompt is required");
        if (input.model && !/^[^/]+\/.+$/.test(input.model))
          throw new GittermError("BAD_REQUEST", "Model must use provider/model format");
        if (input.waitForSetup) {
          const deadline = Date.now() + (input.setupTimeoutMs ?? 10 * 60_000);
          while (true) {
            aborted(input.signal);
            const status = await getSetupStatus(input.workspace);
            if (status.status === "succeeded" || status.status === "not_requested") break;
            if (status.status === "failed")
              throw new GittermError("BAD_REQUEST", `Workspace setup failed: ${status.log ?? ""}`);
            if (Date.now() >= deadline)
              throw new GittermError("TIMEOUT", "Workspace setup timed out");
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        }
        const runtime = directRuntime(input.workspace, options.fetch);
        const previous = input.context?.type === "continue" ? input.context.run : undefined;
        if (
          previous &&
          (previous.workspaceId !== input.workspace.id || !terminal(previous.status))
        ) {
          throw new GittermError("CONFLICT", "Continue a terminal run from the same workspace");
        }
        let sessionId = previous?.sessionId;
        let title = input.title ?? "Agent run";
        const now = new Date().toISOString();
        const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
        try {
          aborted(input.signal);
          if (!sessionId) {
            const session = await runtime.createSession(input);
            sessionId = session.id;
            title = session.title;
          }
          aborted(input.signal);
          await runtime.prompt({
            sessionId,
            messageId,
            prompt: input.prompt,
            agent: input.agent,
            model: input.model,
          });
          return {
            id: randomUUID(),
            workspaceId: input.workspace.id,
            workspace: input.workspace,
            sessionId,
            messageId,
            title,
            status: "running",
            error: null,
            finalText: null,
            pendingInputs: [],
            context: previous ? { type: "continued", runId: previous.id } : { type: "isolated" },
            createdAt: now,
            submittedAt: now,
            completedAt: null,
          };
        } catch (error) {
          if (sessionId && !previous) await runtime.deleteSession(sessionId).catch(() => {});
          throw directError(error);
        }
      },
    },
  };
}

export type DirectGittermClient = ReturnType<typeof createDirectGittermClient>;
