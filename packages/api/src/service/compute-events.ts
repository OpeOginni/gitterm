import { EventEmitter } from "node:events";
import { db, eq } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import env, { isComputeEnabled } from "@gitterm/env/server";
import { sandboxHandle } from "./sandbox-transport";

/** A job in one of the user's sandboxes finished. `sandboxId` is the Gitterm sandbox id. */
export type SandboxJobFinished = {
  sandboxId: string;
  jobId: string;
  status: string;
  exitCode: number | null;
};

/** Keyed by user id. */
const jobs = new EventEmitter();
jobs.setMaxListeners(0);
let started = false;

/**
 * gitterm.dev only. Each server process keeps one connection to the sandbox service's event
 * stream and hands job events to its own subscribers, so any number of server replicas work
 * without a shared bus. It starts with the first subscriber and follows new events only;
 * anything missed while no process listened is covered by the plugin's slower polling.
 */
export function computeJobEvents(): EventEmitter | undefined {
  if (!isComputeEnabled()) return undefined;
  if (!started) {
    started = true;
    follow();
  }
  return jobs;
}

function follow() {
  void followComputeEvents({
    url: env.COMPUTE_URL!,
    serviceToken: env.COMPUTE_SERVICE_TOKEN!,
    onJobFinished: deliver,
  });
}

/**
 * Reads the sandbox service's event stream forever, from new events on, reconnecting with
 * backoff and resuming after the last event seen. Stops when `signal` aborts.
 */
export async function followComputeEvents(options: {
  url: string;
  serviceToken: string;
  onJobFinished: (event: ComputeEvent) => Promise<void> | void;
  signal?: AbortSignal;
}) {
  let after = "latest";
  let delay = 1_000;
  while (!options.signal?.aborted) {
    try {
      const response = await fetch(`${options.url.replace(/\/$/, "")}/v1/events?after=${after}`, {
        headers: { authorization: `Bearer ${options.serviceToken}` },
        signal: options.signal,
      });
      if (!response.ok || !response.body) throw new Error(`event stream: ${response.status}`);
      delay = 1_000;
      let buffer = "";
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const fields = Object.fromEntries(
            message.split("\n").map((line) => {
              const colon = line.indexOf(":");
              return [line.slice(0, colon), line.slice(colon + 1).trimStart()];
            }),
          );
          if (fields.id) after = fields.id;
          if (fields.event === "job.finished")
            await options.onJobFinished(JSON.parse(fields.data ?? "{}") as ComputeEvent);
        }
      }
    } catch (error) {
      if (options.signal?.aborted) return;
      console.error("[compute] event stream interrupted:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 30_000);
  }
}

type ComputeEvent = {
  sandboxId?: string;
  data?: { jobId?: string; status?: string; exitCode?: number | null };
};

async function deliver(event: ComputeEvent) {
  if (!event.sandboxId || !event.data?.jobId || !jobs.listenerCount) return;
  const row = await db.query.workspace.findFirst({
    where: eq(workspace.externalInstanceId, sandboxHandle("gitterm", event.sandboxId)),
    columns: { id: true, userId: true },
  });
  if (!row || jobs.listenerCount(row.userId) === 0) return;
  jobs.emit(row.userId, {
    sandboxId: row.id,
    jobId: event.data.jobId,
    status: event.data.status ?? "unknown",
    exitCode: event.data.exitCode ?? null,
  } satisfies SandboxJobFinished);
}
