import { deriveRunState, getRuntime } from "@gitterm/agent-runtime";
import { RuntimeHttpError } from "@gitterm/agent-runtime/http";
import { questionAnswers } from "@gitterm/agent-runtime/replies";
import { GittermError } from "../errors.js";
import { abortable, aborted, delay, runHelpers, terminal } from "../runs.js";
import type { AgentRunReply, RunWatchOptions } from "../types.js";
import type { DirectRun, DirectRunMessage, DirectWorkspace } from "./types.js";

/** @internal The protocol adapter is bundled, not part of the public SDK contract. */
export function directRuntime(
  workspace: DirectWorkspace,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
) {
  return getRuntime({
    url: workspace.runtime.url,
    directory: workspace.runtime.directory,
    password: workspace.runtime.password ?? null,
    headers: workspace.runtime.headers,
    api: workspace.opencodeApi,
    fetch: fetchImpl,
    signal,
  });
}

export function directError(error: unknown): GittermError {
  if (error instanceof GittermError) return error;
  if (error instanceof RuntimeHttpError) {
    return new GittermError(
      error.status === 404
        ? "NOT_FOUND"
        : error.status === 401
          ? "UNAUTHORIZED"
          : error.status === 403
            ? "FORBIDDEN"
            : error.status >= 500
              ? "SERVER_ERROR"
              : "BAD_REQUEST",
      error.message,
      { cause: error },
    );
  }
  return new GittermError(
    "NETWORK",
    error instanceof Error ? error.message : "OpenCode request failed",
    { cause: error },
  );
}

export function directRunOperations(
  assertWorkspace: (workspace: DirectWorkspace) => void,
  fetchImpl?: typeof fetch,
) {
  function assertRun(run: DirectRun) {
    assertWorkspace(run.workspace);
    if (run.workspaceId !== run.workspace.id)
      throw new GittermError("BAD_REQUEST", "Run belongs to another workspace");
  }
  async function get(
    run: DirectRun,
    sessionError?: string | null,
    signal?: AbortSignal,
  ): Promise<DirectRun> {
    assertRun(run);
    if (terminal(run.status)) return run;
    try {
      const snapshot = await directRuntime(run.workspace, fetchImpl, signal).snapshot(
        run.sessionId,
        run.messageId,
      );
      const derived = deriveRunState(snapshot, {
        submittedAt: run.submittedAt ? new Date(run.submittedAt) : null,
        sessionError,
      });
      return {
        ...run,
        status: derived.status,
        error: derived.errorMessage,
        finalText: snapshot.finalText,
        pendingInputs: terminal(derived.status) ? [] : snapshot.pendingInputs,
        completedAt: terminal(derived.status) ? new Date().toISOString() : null,
      };
    } catch (error) {
      throw directError(error);
    }
  }
  async function respond(
    run: DirectRun,
    input: { requestId: string; reply: AgentRunReply },
  ): Promise<DirectRun> {
    const current = await get(run);
    const request = current.pendingInputs.find((candidate) => candidate.id === input.requestId);
    if (current.status !== "awaiting_input" || !request)
      throw new GittermError("INPUT_NOT_PENDING", "Input request is no longer pending");
    const runtime = directRuntime(run.workspace, fetchImpl);
    if (request.kind !== input.reply.type)
      throw new GittermError("BAD_REQUEST", "Reply type does not match the input request");
    if (
      input.reply.type === "question" &&
      ("answers" in input.reply ? "reject" in input.reply : input.reply.reject !== true)
    ) {
      throw new GittermError(
        "BAD_REQUEST",
        "Question replies require answers or an explicit rejection, not both",
      );
    }
    let answers: string[][] | undefined;
    if (
      request.kind === "question" &&
      input.reply.type === "question" &&
      "answers" in input.reply
    ) {
      try {
        answers = questionAnswers(request, input.reply.answers);
      } catch (error) {
        throw new GittermError(
          "BAD_REQUEST",
          error instanceof Error ? error.message : "Invalid answers",
        );
      }
    }
    try {
      if (request.kind === "permission" && input.reply.type === "permission") {
        if (!["once", "always", "reject"].includes(input.reply.response))
          throw new GittermError("BAD_REQUEST", "Invalid permission response");
        await runtime.replyPermission(run.sessionId, request.id, input.reply.response);
      } else if (request.kind === "question") {
        if (answers) await runtime.replyQuestion(run.sessionId, request, answers);
        else await runtime.rejectQuestion(run.sessionId, request.id);
      }
    } catch (error) {
      if (error instanceof RuntimeHttpError && error.status === 404)
        throw new GittermError(
          "INPUT_NOT_PENDING",
          "Input request was resolved by another responder",
        );
      throw directError(error);
    }
    return get(current);
  }

  async function* watch(run: DirectRun, options?: RunWatchOptions): AsyncGenerator<DirectRun> {
    assertRun(run);
    aborted(options?.signal);
    if (terminal(run.status)) {
      yield run;
      return;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    const runtime = directRuntime(run.workspace, fetchImpl);
    let dirty = false;
    let wake: (() => void) | undefined;
    let sessionError: string | null = null;
    let streamError: unknown;
    const notify = () => {
      dirty = true;
      wake?.();
      wake = undefined;
    };
    const probe = setInterval(notify, 60_000);
    const pump = (async () => {
      let backoff = 1_000;
      while (!controller.signal.aborted) {
        try {
          for await (const event of runtime.subscribe(controller.signal)) {
            if (event.type === "connected") {
              backoff = 1_000;
              notify();
            } else if (event.sessionId === run.sessionId) {
              if (event.type === "session.error") sessionError = event.message;
              notify();
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof RuntimeHttpError && [400, 401, 403, 404].includes(error.status)) {
            streamError = error;
            notify();
            return;
          }
        }
        // Reconnect + fresh snapshot repairs missed events; no event replay is claimed.
        await delay(backoff, controller.signal).catch(() => {});
        backoff = Math.min(backoff * 2, 30_000);
      }
    })();
    let current = run;
    let previous: string | undefined;
    try {
      while (true) {
        aborted(options?.signal);
        if (!dirty)
          await abortable(
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
            controller.signal,
          );
        dirty = false;
        if (streamError) throw directError(streamError);
        current = await abortable(get(current, sessionError, controller.signal), controller.signal);
        const key = JSON.stringify([current.status, current.pendingInputs]);
        if (key !== previous) {
          previous = key;
          yield current;
        }
        if (terminal(current.status)) return;
      }
    } finally {
      clearInterval(probe);
      options?.signal?.removeEventListener("abort", onAbort);
      controller.abort();
      await pump;
    }
  }
  return {
    get: (run: DirectRun): Promise<DirectRun> => get(run),
    watch,
    respond,
    ...runHelpers({ watch, respond }),
    async messages(run: DirectRun): Promise<DirectRunMessage[]> {
      assertRun(run);
      try {
        return (
          await directRuntime(run.workspace, fetchImpl).snapshot(run.sessionId, run.messageId)
        ).messages;
      } catch (error) {
        throw directError(error);
      }
    },
    async cancel(run: DirectRun): Promise<{ cancelled: boolean }> {
      const current = await get(run);
      if (terminal(current.status)) return { cancelled: current.status === "cancelled" };
      const runtime = directRuntime(run.workspace, fetchImpl);
      try {
        for (const request of current.pendingInputs) {
          if (request.kind === "permission")
            await runtime.replyPermission(run.sessionId, request.id, "reject");
          else await runtime.rejectQuestion(run.sessionId, request.id);
        }
        await runtime.abort(run.sessionId);
        return { cancelled: true };
      } catch (error) {
        throw directError(error);
      }
    },
  };
}
