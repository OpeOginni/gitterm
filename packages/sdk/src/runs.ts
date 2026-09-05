import { AgentRunError, GittermError } from "./errors.js";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunReply,
  AgentRunResult,
  RunResultOptions,
  RunWaitOptions,
  RunWatchOptions,
} from "./types.js";

export function terminal(status: AgentRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new GittermError("ABORTED", "Run observation was aborted; the agent was not cancelled");
}

export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) void operation.catch(() => {});
  aborted(signal);
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(
            new GittermError("ABORTED", "Run observation was aborted; the agent was not cancelled"),
          );
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GittermError("ABORTED", "Operation aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function deadline<T>(
  options: { signal?: AbortSignal; timeoutMs?: number } | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  aborted(options?.signal);
  const timeoutMs = options?.timeoutMs ?? 30 * 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new GittermError("BAD_REQUEST", "timeoutMs must be finite and non-negative");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut)
      throw new GittermError("TIMEOUT", "Run observation timed out; the agent was not cancelled", {
        cause: error,
      });
    aborted(options?.signal);
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

/** Deduplication is subscriber-local, not an exactly-once delivery guarantee. */
export async function* runEvents<T extends AgentRun>(
  states: AsyncIterable<T>,
): AsyncGenerator<AgentRunEvent<T>> {
  const seen = new Set<string>();
  let pending = new Set<string>();
  let status: T["status"] | undefined;
  for await (const run of states) {
    if (run.status !== status) {
      status = run.status;
      yield { type: "run.status", run };
    }
    const current = new Set(run.pendingInputs.map((request) => request.id));
    for (const requestId of pending) {
      if (!current.has(requestId)) yield { type: "input.resolved", run, requestId };
    }
    pending = current;
    for (const request of run.pendingInputs) {
      if (seen.has(request.id)) continue;
      seen.add(request.id);
      yield { type: "input.required", run, request };
    }
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      yield { type: `run.${run.status}`, run };
      return;
    }
  }
}

/** Same interaction helpers for hosted and direct runs. */
export function runHelpers<Ref, T extends AgentRun>(operations: {
  watch(ref: Ref, options?: RunWatchOptions): AsyncIterable<T>;
  respond(ref: Ref, input: { requestId: string; reply: AgentRunReply }): Promise<T>;
}) {
  return {
    events: (ref: Ref, options?: RunWatchOptions): AsyncIterable<AgentRunEvent<T>> =>
      runEvents(operations.watch(ref, options)),
    wait: (ref: Ref, options?: RunWaitOptions): Promise<T> =>
      deadline(options, async (signal) => {
        for await (const run of operations.watch(ref, { signal })) {
          if (
            terminal(run.status) ||
            (run.status === "awaiting_input" && options?.until !== "terminal")
          )
            return run;
        }
        throw new GittermError("NETWORK", "Run stream ended before a terminal state");
      }),
    result: (ref: Ref, options?: RunResultOptions): Promise<AgentRunResult<T>> =>
      deadline(options, async (signal) => {
        for await (const event of runEvents(operations.watch(ref, { signal }))) {
          aborted(signal);
          if (event.type === "run.completed") return event.run as AgentRunResult<T>;
          if (event.type === "run.failed") throw new AgentRunError(event.run, "RUN_FAILED");
          if (event.type === "run.cancelled") throw new AgentRunError(event.run, "RUN_CANCELLED");
          if (event.type !== "input.required") continue;
          const { request } = event;
          let reply: AgentRunReply;
          if (request.kind === "permission") {
            if (!options?.onPermission) throw new AgentRunError(event.run, "INPUT_REQUIRED");
            reply = {
              type: "permission",
              response: await abortable(
                Promise.resolve(options.onPermission(request, { signal })),
                signal,
              ),
            };
          } else {
            if (!options?.onQuestion) throw new AgentRunError(event.run, "INPUT_REQUIRED");
            reply = {
              type: "question",
              ...(await abortable(
                Promise.resolve(options.onQuestion(request, { signal })),
                signal,
              )),
            };
          }
          aborted(signal);
          try {
            await abortable(operations.respond(ref, { requestId: request.id, reply }), signal);
          } catch (error) {
            // Another responder may have resolved the request while our UI was open.
            if (!(error instanceof GittermError) || error.code !== "INPUT_NOT_PENDING") throw error;
          }
        }
        throw new GittermError("NETWORK", "Run stream ended before a terminal state");
      }),
  };
}
