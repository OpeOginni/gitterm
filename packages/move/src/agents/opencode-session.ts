import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { PASSIVE_REQUEST_HEADER, type WorkspaceRuntimeAccess } from "@gitterm/sdk";

/**
 * OpenCode's sessions, through its server API: what moving one needs on either machine.
 * Used by the OpenCode adapter and by the `/cloud` plugin.
 */

/**
 * Session instruction entry telling the agent which machine it is on after a move. Unlike a
 * message, it stays in the agent's instructions through compaction. Session export leaves
 * entries out, so each side only ever has the one it was given.
 */
export const MOVED_ENTRY = "gitterm-moved";

/**
 * Tells the agent it changed machines, with an instruction entry: it lasts through compaction.
 * On a session that was just imported, the entry only reaches the system prompt, with no place
 * in the conversation, and the agent took its earlier answers about the other machine for
 * mistakes. `imported` adds the same words as a note at this point in the conversation. On a
 * session that was not replaced, OpenCode already shows a changed entry there.
 * The whole story, and how to check it: docs/internals.md, "How the agent learns it moved".
 */
export async function tellMoved(
  client: OpenCodeClient,
  sessionID: string,
  lines: string[],
  imported: boolean,
  signal: AbortSignal,
) {
  const text = lines.join("\n");
  await client.session.instructions.entry.put(
    { sessionID, key: MOVED_ENTRY, value: text },
    { signal },
  );
  // The model gets notes in the user's role, so say where it comes from, the way OpenCode
  // wraps its own notices such as subagent reports. The terminal does not show it.
  if (imported)
    await client.session.synthetic(
      {
        sessionID,
        text: `<session-moved source="gitterm">\nA notice from GitTerm, not a message from the user.\n${text}\n</session-moved>`,
        resume: false,
        metadata: { source: "gitterm" },
      },
      { signal },
    );
}
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .toSorted(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const historyDigest = (messages: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(messages)))
    .digest("hex");
/**
 * The same over what was said and done only. OpenCode's own records of an agent or model
 * being selected appear when a prompt is merely typed, so they do not count as a change.
 */
export const conversationDigest = (messages: ReadonlyArray<{ type: string }>) =>
  historyDigest(
    messages.filter((item) => item.type !== "agent-switched" && item.type !== "model-switched"),
  );

type InboxItem = Awaited<ReturnType<OpenCodeClient["session"]["inbox"]["list"]>>[number];
/**
 * Input that starts the agent: a message, a compaction, or a subagent reporting back. Notices
 * such as a `!shell` result only ride along with the next prompt, so they don't count.
 */
const wakes = (item: InboxItem) =>
  item.type !== "synthetic" || item.payload.metadata?.source === "subagent";

/** Whether a session's agent or a subagent of it is running, or input is waiting that starts it. */
export async function sessionBusy(
  client: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
): Promise<boolean> {
  const [active, jobs, inbox] = await Promise.all([
    client.session.active({ signal }),
    client.experimental.job.list({ sessionID, status: "running", descendants: true }, { signal }),
    client.session.inbox.list({ sessionID }, { signal }),
  ]);
  return Boolean(active[sessionID]) || jobs.length > 0 || inbox.some(wakes);
}

/**
 * The session's position in OpenCode's event log. It rises with everything that happens to the
 * session: messages, notes, metadata, and input queued for later. Read from past its end, the
 * log sends only that position.
 */
export async function sessionRevision(
  client: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
): Promise<number> {
  const log = client.experimental.session.log(
    { sessionID, after: Number.MAX_SAFE_INTEGER },
    { signal },
  );
  for await (const item of log) if (item.type === "log.synced") return item.seq ?? 0;
  throw new Error("OpenCode's session log ended without its position.");
}

/**
 * Stops the session's agent and its subagents, and waits until they stay stopped: a stopped
 * subagent reports back, which wakes its parent once more. Returns whether anything ran.
 */
export async function stopSession(
  client: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
  pollMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  let stopped = false;
  for (let quiet = 0; quiet < 3; ) {
    if (Date.now() > deadline) throw new Error("The agent did not stop. Stop it, then try again.");
    const [active, jobs, inbox] = await Promise.all([
      client.session.active({ signal }),
      client.experimental.job.list({ sessionID, status: "running", descendants: true }, { signal }),
      client.session.inbox.list({ sessionID }, { signal }),
    ]);
    // A subagent runs in a child session; interrupting the parent does not stop it.
    const running = [
      ...(active[sessionID] ? [sessionID] : []),
      ...jobs.flatMap((job) =>
        job.kind === "subagent" && job.childSessionID ? [job.childSessionID] : [],
      ),
    ];
    if (running.length === 0 && !inbox.some(wakes)) {
      quiet++;
    } else {
      quiet = 0;
      stopped = true;
      await Promise.all(
        running.map((id) =>
          client.session.interrupt({ sessionID: id }, { signal }).catch(() => {}),
        ),
      );
    }
    await delay(pollMs, undefined, { signal });
  }
  return stopped;
}

/**
 * `passive` marks every request as observation only, so GitTerm does not count it as use of
 * the workspace: a status check must not keep an idle workspace from pausing.
 */
export function runtimeClient(
  runtime: WorkspaceRuntimeAccess,
  options: { passive?: boolean } = {},
): OpenCodeClient {
  if (!runtime.url) throw new Error("The workspace does not have an OpenCode server URL.");
  const url = new URL(runtime.url);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("Cloud handoff requires HTTPS (or a loopback development server).");
  }
  const headers = new Headers(runtime.headers);
  if (runtime.password)
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`opencode:${runtime.password}`).toString("base64")}`,
    );
  if (!headers.has("Authorization"))
    throw new Error("The workspace did not return an OpenCode access credential.");
  if (options.passive) headers.set(PASSIVE_REQUEST_HEADER, "1");
  return OpenCode.make({
    baseUrl: runtime.url,
    headers,
    // Do not forward credentials or snapshots through an upstream redirect.
    fetch: ((input, init) => fetch(input, { ...init, redirect: "error" })) as typeof fetch,
  });
}

/**
 * Whether the OpenCode server offers a model. Its catalog fills in a few seconds after it
 * starts, so a missing model is only concluded once the catalog has stopped growing.
 */
export async function offersModel(
  client: OpenCodeClient,
  directory: string,
  model: { providerID: string; id: string },
  signal: AbortSignal,
  pollMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  let previous = -1;
  let steady = 0;
  for (;;) {
    const { data } = await client.model.list({ location: { directory } }, { signal });
    if (data.some((entry) => entry.providerID === model.providerID && entry.id === model.id))
      return true;
    steady = data.length > 0 && data.length === previous ? steady + 1 : 0;
    previous = data.length;
    if (steady >= 4 || Date.now() >= deadline) return false;
    await delay(pollMs, undefined, { signal });
  }
}

export function importPayload(
  data: Awaited<ReturnType<OpenCodeClient["session"]["export"]>>,
  directory: string,
  options: { keepModel?: boolean } = {},
): Parameters<OpenCodeClient["session"]["import"]>[0] {
  // Machine-local state must not transfer; unavailable models use the destination default.
  const {
    parentID: _parent,
    fork: _fork,
    revert: _revert,
    permissions: _permissions,
    model,
    ...rest
  } = data.info;
  const info = options.keepModel === false || !model ? rest : { ...rest, model };
  return {
    info: { ...info, location: { directory } },
    messages: data.messages,
    location: { directory },
  };
}

/** Continues the moved session in the cloud: with the user's message, or where it was stopped. */
