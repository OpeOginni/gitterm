import { randomUUID } from "node:crypto";
import { createOpencodeClient, type SessionStatus } from "@opencode-ai/sdk";
import {
  createOpencodeClient as createOpencodeV2Client,
  type IntegrationAttemptStatus,
} from "@opencode-ai/sdk/v2";
import { createAsciiDirectProvider } from "./ascii.js";
import { createDaytonaDirectProvider } from "./daytona.js";
import { createE2BDirectProvider } from "./e2b.js";
import { createExeDevDirectProvider } from "./exedev.js";
import { buildDirectProvisioningPlan, directModelAuth } from "./provisioning.js";
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
  DirectRunMessage,
  DirectRunWaitOptions,
  DirectWorkspace,
  DirectWorkspaceCreateInput,
} from "./types.js";

export type DirectGittermClientOptions = {
  provider: DirectProviderAdapter | DirectProviderConfig;
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

function runtimeClient(workspace: DirectWorkspace) {
  const authorization = workspace.runtime.password
    ? `Basic ${Buffer.from(`opencode:${workspace.runtime.password}`).toString("base64")}`
    : undefined;
  return createOpencodeClient({
    baseUrl: workspace.runtime.url,
    directory: workspace.runtime.directory,
    headers: {
      ...workspace.runtime.headers,
      ...(authorization ? { Authorization: authorization } : {}),
    },
  });
}

function authClient(workspace: DirectWorkspace) {
  const authorization = workspace.runtime.password
    ? `Basic ${Buffer.from(`opencode:${workspace.runtime.password}`).toString("base64")}`
    : undefined;
  return createOpencodeV2Client({
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

function mapStatus(
  status: SessionStatus | undefined,
  errorName?: string,
  assistantCompleted = true,
): DirectRun["status"] {
  if (errorName === "MessageAbortedError") return "cancelled";
  if (errorName) return "failed";
  if (status?.type === "busy") return "running";
  if (status?.type === "retry") return "retrying";
  if (!assistantCompleted) return "running";
  return "completed";
}

function modelParts(model?: string) {
  if (!model) return undefined;
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error('model must use the "provider/model" format');
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

export function createDirectGittermClient(options: DirectGittermClientOptions) {
  const provider = resolveProvider(options.provider);

  function assertWorkspace(workspace: DirectWorkspace) {
    if (workspace.provider !== provider.name) {
      throw new Error(`Workspace belongs to ${workspace.provider}, not ${provider.name}`);
    }
  }

  function assertRunWorkspace(run: DirectRun, workspace: DirectWorkspace) {
    assertWorkspace(workspace);
    if (run.workspaceId !== workspace.id) {
      throw new Error(`Run belongs to workspace ${run.workspaceId}, not ${workspace.id}`);
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

  async function getRun(run: DirectRun, workspace: DirectWorkspace) {
    assertRunWorkspace(run, workspace);
    const client = runtimeClient(workspace);
    const [statuses, messages] = await Promise.all([
      client.session.status({ query: { directory: workspace.runtime.directory } }),
      client.session.messages({
        path: { id: run.sessionId },
        query: { directory: workspace.runtime.directory },
      }),
    ]);
    if (statuses.error || !statuses.data) throw new Error(errorMessage(statuses.error));
    if (messages.error || !messages.data) throw new Error(errorMessage(messages.error));
    const related = messages.data.filter(
      (message) =>
        message.info.id === run.messageId ||
        (message.info.role === "assistant" && message.info.parentID === run.messageId),
    );
    const assistant = related.findLast((message) => message.info.role === "assistant");
    const assistantError = assistant?.info.role === "assistant" ? assistant.info.error : undefined;
    const assistantCompleted =
      assistant?.info.role === "assistant" && assistant.info.time.completed != null;
    const finalText = assistant?.parts
      .filter((part) => part.type === "text" && !part.ignored)
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim();
    const status = assistant
      ? mapStatus(statuses.data[run.sessionId], assistantError?.name, assistantCompleted)
      : statuses.data[run.sessionId]?.type === "idle"
        ? Date.now() - new Date(run.submittedAt).getTime() < 5_000
          ? "running"
          : "failed"
        : mapStatus(statuses.data[run.sessionId]);
    return {
      ...run,
      status,
      error: assistantError
        ? errorMessage(assistantError)
        : status === "failed"
          ? "OpenCode stopped before producing an assistant response"
          : null,
      finalText: finalText || null,
    } satisfies DirectRun;
  }

  return {
    provider: { name: provider.name, capabilities: provider.capabilities },
    auth: {
      async setCredential(
        workspace: DirectWorkspace,
        credential: DirectModelCredential,
      ): Promise<void> {
        assertWorkspace(workspace);
        if (!credential.providerName.trim()) {
          throw new Error("Model credential providerName is required");
        }
        const result = await runtimeClient(workspace).auth.set({
          path: { id: credential.providerName },
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
        const timeoutMs = wait.timeoutMs ?? Math.max(0, attempt.expiresAt - Date.now());
        const pollIntervalMs = wait.pollIntervalMs ?? 1_000;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
          const status = await getAuthStatus(attempt, workspace);
          if (status.status === "complete") return status;
          if (status.status === "failed") throw new Error(status.message);
          if (status.status === "expired") throw new Error("OAuth attempt expired");
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
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
        const lifecycle = input.lifecycle ?? provider.capabilities.recommendedLifecycle;
        if (lifecycle === "persistent" && provider.capabilities.persistence === "unsupported") {
          throw new Error(`${provider.name} does not support persistent direct workspaces`);
        }
        const id = input.id ?? randomUUID();
        const password = randomUUID();
        const provisioning = buildDirectProvisioningPlan({ ...input, id, lifecycle, password });
        const created = await provider.create({ ...input, id, lifecycle, password, provisioning });
        return {
          id,
          provider: provider.name,
          externalId: created.externalId,
          status: "running",
          lifecycle,
          runtime: created.runtime,
          createdAt: new Date().toISOString(),
        };
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
    },
    runs: {
      async create(input: DirectRunCreateInput): Promise<DirectRun> {
        assertWorkspace(input.workspace);
        const client = runtimeClient(input.workspace);
        let sessionId = input.sessionId;
        let title = input.title ?? "Agent run";
        if (!sessionId) {
          const created = await client.session.create({
            body: input.title ? { title: input.title } : undefined,
            query: { directory: input.workspace.runtime.directory },
          });
          if (created.error || !created.data) throw new Error(errorMessage(created.error));
          sessionId = created.data.id;
          title = created.data.title;
        }
        const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
        const prompted = await client.session.promptAsync({
          path: { id: sessionId },
          query: { directory: input.workspace.runtime.directory },
          body: {
            messageID: messageId,
            parts: [{ type: "text", text: input.prompt }],
            agent: input.agent,
            model: modelParts(input.model),
          },
        });
        if (prompted.error) throw new Error(errorMessage(prompted.error));
        return {
          id: randomUUID(),
          workspaceId: input.workspace.id,
          sessionId,
          messageId,
          title,
          status: "running",
          error: null,
          finalText: null,
          submittedAt: new Date().toISOString(),
        };
      },
      get: getRun,
      async wait(
        run: DirectRun,
        workspace: DirectWorkspace,
        wait: DirectRunWaitOptions = {},
      ): Promise<DirectRun> {
        const timeoutMs = wait.timeoutMs ?? 10 * 60_000;
        const pollIntervalMs = wait.pollIntervalMs ?? 1_000;
        const deadline = Date.now() + timeoutMs;
        let current = run;
        while (Date.now() < deadline) {
          current = await getRun(current, workspace);
          if (!["running", "retrying"].includes(current.status)) return current;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
        throw new Error(`Agent run timed out after ${timeoutMs}ms`);
      },
      async messages(run: DirectRun, workspace: DirectWorkspace): Promise<DirectRunMessage[]> {
        assertRunWorkspace(run, workspace);
        const result = await runtimeClient(workspace).session.messages({
          path: { id: run.sessionId },
          query: { directory: workspace.runtime.directory },
        });
        if (result.error || !result.data) throw new Error(errorMessage(result.error));
        return result.data
          .filter(
            (message) =>
              message.info.id === run.messageId ||
              (message.info.role === "assistant" && message.info.parentID === run.messageId),
          )
          .map((message) => ({
            id: message.info.id,
            role: message.info.role,
            text: message.parts
              .filter((part) => part.type === "text" && !part.ignored)
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("\n")
              .trim(),
            error:
              message.info.role === "assistant" && message.info.error
                ? errorMessage(message.info.error)
                : null,
          }));
      },
      async cancel(run: DirectRun, workspace: DirectWorkspace): Promise<boolean> {
        assertRunWorkspace(run, workspace);
        const result = await runtimeClient(workspace).session.abort({
          path: { id: run.sessionId },
          query: { directory: workspace.runtime.directory },
        });
        if (result.error) throw new Error(errorMessage(result.error));
        return result.data === true;
      },
    },
  };
}

export type DirectGittermClient = ReturnType<typeof createDirectGittermClient>;
