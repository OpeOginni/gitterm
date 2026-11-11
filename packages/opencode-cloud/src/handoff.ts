import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import {
  GittermError,
  type GittermClient,
  type WorkspaceProviderSelection,
  type WorkspaceRuntimeAccess,
} from "@gitterm/sdk";
import {
  captureSnapshot,
  checkoutRoot,
  encodeSnapshot,
  repositoryUrl,
  sharedCheckoutSessions,
  type CheckoutSnapshot,
} from "./snapshot";
import {
  PREPARE_STAGE_SCRIPT,
  RESTORE_NEEDS_FULL_HISTORY,
  RESTORE_SCRIPT,
  shellQuote,
} from "./restore";

export type HandoffOptions = {
  serverUrl?: string;
  token?: string;
  provider?: WorkspaceProviderSelection;
  persistent?: boolean;
  name?: string;
  connections?: string[];
  localServerUrl?: string;
  localServerPassword?: string;
};

export type HandoffRecord = {
  attemptID: string;
  sessionID: string;
  phase: "creating" | "restoring" | "importing" | "ready" | "failed";
  workspaceID?: string;
  sourceDirectory: string;
  head: string;
  includeChanges: boolean;
  sharedSessions: number;
  createdAt: string;
};

type FormFields = Parameters<OpenCodeClient["session"]["form"]["create"]>[0]["fields"];
export type HandoffDependencies = {
  local: OpenCodeClient;
  gitterm: GittermClient;
  options: HandoffOptions;
  signal: AbortSignal;
  save(record: HandoffRecord): Promise<void>;
  progress(text: string): Promise<void>;
};

const STEPS: Record<HandoffRecord["phase"], string> = {
  creating: "creating the cloud workspace",
  restoring: "restoring your checkout in the cloud",
  importing: "importing this session into the cloud",
  ready: "finishing",
  failed: "finishing",
};

/** A failure whose message is safe and useful to show the user as is. */
class HandoffRefused extends Error {}

/** Session metadata key holding the digest of the history a handoff imported. */
const HISTORY_KEY = "gittermHandoffHistory";
/** Metadata key on the note a handoff leaves in the cloud session's pending input. */
const NOTE_KEY = "gittermHandoff";
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
// OpenCode returns imported messages unchanged apart from key order.
const historyDigest = (messages: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(messages)))
    .digest("hex");

export class HandoffCancelled extends Error {
  constructor() {
    super("Cloud handoff cancelled. Local files and sessions are unchanged.");
  }
}

export function changePrompt(sharedCount: number): string {
  return [
    "Copies this checkout's tracked edits and non-ignored untracked files. Local files remain unchanged.",
    sharedCount > 0
      ? `${sharedCount} other active session(s) use this checkout. Their changes may be included too.`
      : "",
    "Other OpenCode servers, editors, and background writers cannot all be detected. Pause writers for a consistent snapshot.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function askForm(
  client: OpenCodeClient,
  sessionID: string,
  title: string,
  fields: FormFields,
  signal: AbortSignal,
): Promise<Record<string, string | number | boolean | readonly string[]>> {
  const form = await client.session.form.create({ sessionID, title, fields }, { signal });
  const deadline = Date.now() + 10 * 60_000;
  try {
    while (Date.now() < deadline) {
      const detail = await client.session.form.get({ sessionID, formID: form.id }, { signal });
      if (detail.state.status === "cancelled") throw new HandoffCancelled();
      if (detail.state.status === "answered") return detail.state.answer;
      await delay(400, undefined, { signal });
    }
    throw new HandoffCancelled();
  } finally {
    // Also dismiss outstanding forms on unload/timeout. Never cancel other forms.
    await client.session.form
      .cancel({ sessionID, formID: form.id }, { signal: AbortSignal.timeout(5_000) })
      .catch(() => {});
  }
}

async function assertIdle(client: OpenCodeClient, sessionID: string, signal: AbortSignal) {
  if ((await client.session.active({ signal }))[sessionID]) {
    throw new Error(
      "Stop this session's running agent before continuing in the cloud. Other sessions will not be interrupted.",
    );
  }
  const jobs = await client.experimental.job.list(
    { sessionID, status: "running", descendants: true },
    { signal },
  );
  if (jobs.length > 0)
    throw new Error(
      "This session has running background jobs. Let them finish or stop them before continuing in the cloud; running processes cannot be transferred.",
    );
  if ((await client.session.inbox.list({ sessionID }, { signal })).length > 0) {
    throw new Error(
      "This session has pending input. Finish or cancel it before continuing in the cloud.",
    );
  }
}

export function runtimeClient(runtime: WorkspaceRuntimeAccess): OpenCodeClient {
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
  return OpenCode.make({
    baseUrl: runtime.url,
    headers,
    // Do not forward credentials or snapshots through an upstream redirect.
    fetch: ((input, init) => fetch(input, { ...init, redirect: "error" })) as typeof fetch,
  });
}

/** Resolves with the exit code when it is 0 or one of `accept`; any other outcome throws. */
export async function runRemoteShell(
  remote: OpenCodeClient,
  directory: string,
  command: string,
  signal: AbortSignal,
  accept: number[] = [],
): Promise<number> {
  const location = { directory };
  let shell = (
    await remote.shell.create({ location, cwd: directory, command, timeout: 120_000 }, { signal })
  ).data;
  try {
    // Most of these commands finish at once, so look early before settling into a poll.
    let wait = 100;
    while (shell.status === "running") {
      await delay(wait, undefined, { signal });
      wait = 300;
      shell = (await remote.shell.get({ id: shell.id, location }, { signal })).data;
    }
    if (shell.status !== "exited" || (shell.exit !== 0 && !accept.includes(shell.exit ?? -1))) {
      throw new Error(
        "Cloud checkout restoration failed. The workspace is retained for inspection; local files are unchanged.",
      );
    }
    return shell.exit ?? 0;
  } finally {
    // A cancelled command must not keep applying files after we report failure.
    if (shell.status === "running")
      await remote.shell
        .remove({ id: shell.id, location }, { signal: AbortSignal.timeout(5_000) })
        .catch(() => {});
  }
}

export function importPayload(
  data: Awaited<ReturnType<OpenCodeClient["session"]["export"]>>,
  directory: string,
): Parameters<OpenCodeClient["session"]["import"]>[0] {
  // A child session can be continued independently; its parent is not on the destination.
  // Local revert snapshots and filesystem permission grants must not cross machines.
  const {
    parentID: _parent,
    fork: _fork,
    revert: _revert,
    permissions: _permissions,
    ...info
  } = data.info;
  return {
    info: {
      ...info,
      // Lets a retry tell whether the cloud session has moved on since it was imported.
      metadata: { ...info.metadata, [HISTORY_KEY]: historyDigest(data.messages) },
      location: { directory },
    },
    messages: data.messages,
    location: { directory },
  };
}

/**
 * `attemptID` repeats an earlier attempt that did not finish. The workspace is created
 * under a key derived from it, so GitTerm returns that attempt's workspace instead of
 * starting a second one, and each later step picks up what the earlier attempt left.
 */
export async function handoffSession(
  sessionID: string,
  deps: HandoffDependencies,
  attemptID: string = randomUUID(),
): Promise<HandoffRecord> {
  const { local, gitterm, options, signal } = deps;
  await assertIdle(local, sessionID, signal);
  const session = await local.session.get({ sessionID }, { signal });
  const sourceDirectory = await realpath(session.location.directory);
  const root = await checkoutRoot(sourceDirectory);
  const repo = await repositoryUrl(root);
  const active = await local.session.active({ signal });
  const activeSessions = await Promise.all(
    Object.keys(active)
      .filter((id) => id !== sessionID)
      .map((id) => local.session.get({ sessionID: id }, { signal }).catch(() => undefined)),
  );
  const shared = await sharedCheckoutSessions(
    root,
    sessionID,
    activeSessions.filter((item) => item !== undefined),
  );
  const choice = await askForm(
    local,
    sessionID,
    "Continue in GitTerm",
    [
      {
        key: "changes",
        type: "boolean",
        title: "Include uncommitted changes?",
        description: changePrompt(shared.length),
        default: false,
        required: true,
      },
    ],
    signal,
  );
  const includeChanges = choice.changes === true;
  await assertIdle(local, sessionID, signal);
  const snapshot = await captureSnapshot(root, includeChanges);
  const manifest = snapshot.changedPaths
    .slice(0, 100)
    .map((file) => JSON.stringify(file))
    .join("\n");
  const confirmation = await askForm(
    local,
    sessionID,
    "Create cloud workspace?",
    [
      {
        key: "create",
        type: "boolean",
        title: "Upload this snapshot and start billable cloud compute?",
        required: true,
        default: false,
        description: [
          `Repository: ${repo}\nCommit: ${snapshot.head}\nSnapshot: ${(snapshot.bytes / 1024 / 1024).toFixed(2)} MiB`,
          includeChanges
            ? `${snapshot.changedPaths.length} changed paths${manifest ? `:\n${manifest}` : ""}${snapshot.changedPaths.length > 100 ? "\n(additional paths omitted)" : ""}`
            : "Uncommitted changes are excluded.",
          "Uploads this conversation (which may contain secrets) and commits that are not on origin's default branch, including unpublished ones. Ignored files are not separately uploaded; tracked history can contain secrets. Review before approving.",
          "Uses your GitTerm model/repository connections, not separately copied local credential stores. Cloud compute may incur charges until paused or terminated in GitTerm. Local work remains untouched; later local edits will not sync.",
        ].join("\n\n"),
      },
    ],
    signal,
  );
  if (confirmation.create !== true) throw new HandoffCancelled();
  await assertIdle(local, sessionID, signal);
  const exported = await local.session.export({ sessionID }, { signal });
  await assertIdle(local, sessionID, signal);
  if (
    exported.info.location.directory !== session.location.directory ||
    exported.info.time.updated !== session.time.updated
  ) {
    throw new Error("The session changed during handoff preparation. Retry after it is idle.");
  }
  if (Buffer.byteLength(JSON.stringify(exported)) > 25 * 1024 * 1024)
    throw new Error("Session history exceeds the 25 MiB handoff limit.");

  const record: HandoffRecord = {
    attemptID,
    sessionID,
    phase: "creating",
    sourceDirectory: root,
    head: snapshot.head,
    includeChanges,
    sharedSessions: shared.length,
    createdAt: new Date().toISOString(),
  };
  await deps.save(record);
  try {
    await deps.progress(
      "Creating a GitTerm workspace. Your local checkout and sessions remain unchanged.",
    );
    // Clone the remote's default branch first, then restore HEAD from the bundle.
    // Passing an unpublished local branch/SHA here would make provisioning fail.
    const created = await gitterm.workspaces.create({
      idempotencyKey: `opencode-handoff:${record.attemptID}`,
      name: options.name ?? session.title ?? "OpenCode cloud handoff",
      repo,
      agent: "opencode",
      provider: options.provider,
      persistent: options.persistent,
      connections: options.connections,
      metadata: { "opencode.handoff": record.attemptID, "opencode.session": sessionID },
    });
    record.workspaceID = created.workspace.id;
    record.phase = "restoring";
    await deps.save(record);
    await gitterm.workspaces.ensureRunning(record.workspaceID, { signal });
    const runtime = await gitterm.workspaces.getRuntimeAccess(record.workspaceID);
    const remote = runtimeClient(runtime);
    await remote.server.info({ signal });
    const subpath = path.relative(root, sourceDirectory).split(path.sep).join("/");
    if (subpath.startsWith("../") || path.isAbsolute(subpath))
      throw new Error("The session moved outside its source checkout.");
    const directory = path.posix.join(runtime.directory, subpath);
    const stage = `.gitterm-handoff-${record.attemptID}`;
    await deps.progress("Restoring and verifying the captured checkout in the cloud.");
    const restore = async (upload: CheckoutSnapshot) => {
      let finished = false;
      try {
        await runRemoteShell(
          remote,
          runtime.directory,
          `node -e ${shellQuote(PREPARE_STAGE_SCRIPT)} ${shellQuote(stage)}`,
          signal,
        );
        await remote.file.write(
          {
            location: { directory: runtime.directory },
            path: `${stage}/snapshot.bin`,
            payload: encodeSnapshot(upload),
          },
          { signal },
        );
        // The script also creates the session's directory, saving a round trip.
        const exit = await runRemoteShell(
          remote,
          runtime.directory,
          `node -e ${shellQuote(RESTORE_SCRIPT)} ${shellQuote(stage)} ${shellQuote(subpath)}`,
          signal,
          [RESTORE_NEEDS_FULL_HISTORY],
        );
        finished = true;
        return exit;
      } finally {
        // The script removes its own upload when it runs to the end. If it did not (an
        // error, a cancellation), remove only this attempt's upload.
        if (!finished)
          await runRemoteShell(
            remote,
            runtime.directory,
            `node -e ${shellQuote('require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })')} ${shellQuote(stage)}`,
            AbortSignal.timeout(10_000),
          ).catch(() => {});
      }
    };
    // A retry in the same workspace can find the session an earlier attempt imported. It is
    // replaced with the current history only if nothing has happened in it since. Check
    // before touching the checkout, so a refused retry leaves the cloud exactly as it was.
    const untouchedSession = async () => {
      let earlier;
      try {
        earlier = await remote.session.export({ sessionID }, { signal });
      } catch (error) {
        // Only OpenCode saying the session does not exist means there is nothing to protect.
        // Any other failure could hide cloud work, so stop before touching the cloud.
        const missing =
          error instanceof Error &&
          error.name === "SessionNotFoundError" &&
          (error as { sessionID?: unknown }).sessionID === sessionID;
        if (missing) return undefined;
        throw error;
      }
      const pending = await remote.session.inbox.list({ sessionID }, { signal });
      // The only input that may be waiting is the note this attempt left there itself.
      const own = (item: (typeof pending)[number]) =>
        item.type === "synthetic" && item.payload.metadata?.[NOTE_KEY] === record.attemptID;
      const jobs = await remote.experimental.job.list(
        { sessionID, status: "running", descendants: true },
        { signal },
      );
      if (
        earlier.info.metadata?.[HISTORY_KEY] !== historyDigest(earlier.messages) ||
        (await remote.session.active({ signal }))[sessionID] ||
        jobs.length > 0 ||
        !pending.every(own)
      )
        throw new HandoffRefused(
          "The cloud session has new activity since the earlier attempt, so the cloud was left as it is. Continue it in the cloud, or start a new handoff.",
        );
      return earlier;
    };
    const found = await untouchedSession();
    if ((await restore(snapshot)) === RESTORE_NEEDS_FULL_HISTORY) {
      // The cloud clone lacks the commits the snapshot builds on. Send the whole history,
      // but only for the checkout the user approved.
      const full = await captureSnapshot(root, includeChanges, true);
      if (full.digest !== snapshot.digest)
        throw new Error("The checkout changed during handoff. Retry after it is idle.");
      if ((await restore(full)) !== 0) throw new Error("Cloud checkout restoration failed.");
    }
    record.phase = "importing";
    await deps.save(record);
    // Look again: the cloud session must still be untouched at the moment it is replaced.
    const earlier = found && (await untouchedSession());
    if (earlier) await remote.session.remove({ sessionID }, { signal });
    let imported;
    try {
      imported = await remote.session.import(importPayload(exported, directory), { signal });
    } catch (error) {
      // Put the earlier session back rather than leave the cloud without one.
      if (earlier)
        await remote.session
          .import(
            { ...earlier, location: earlier.info.location } as Parameters<
              OpenCodeClient["session"]["import"]
            >[0],
            { signal: AbortSignal.timeout(30_000) },
          )
          .catch(() => {});
      throw error;
    }
    if (imported.id !== sessionID || imported.location.directory !== directory)
      throw new Error("Cloud session verification failed.");
    await remote.session.synthetic(
      {
        sessionID,
        resume: false,
        // Marks the note as this attempt's own, so a retry does not take it for cloud input.
        metadata: { [NOTE_KEY]: record.attemptID },
        text: [
          `Continued from local checkout ${root}. The current cloud working directory is ${directory}.`,
          includeChanges
            ? "The captured checkout includes uncommitted changes, potentially from other sessions."
            : "Uncommitted local changes were excluded; do not assume edits described in history exist here.",
          "Historical absolute paths refer to the old machine. Use the cloud checkout. Local processes, separately ignored files, credential stores, and global plugins/configuration were not migrated. Repository-owned configuration travels with the checkout. Select an available cloud model/agent if needed.",
        ].join("\n"),
      },
      { signal },
    );
    record.phase = "ready";
    await deps.save(record);
    return record;
  } catch (error) {
    const step = STEPS[record.phase];
    record.phase = "failed";
    await deps.save(record);
    // The full error goes to OpenCode's local log. The message keeps only GitTerm's own
    // (already redacted) reason: workspace responses could echo snapshots or credentials.
    console.error("GitTerm cloud handoff failed while", step, error);
    const reason =
      error instanceof GittermError || error instanceof HandoffRefused ? ` ${error.message}` : "";
    throw new Error(
      `Cloud handoff failed while ${step}${record.workspaceID ? ` for workspace ${record.workspaceID}` : ` (attempt ${record.attemptID})`}.${reason} Check GitTerm before retrying; a workspace may still be running and incurring charges. Local files and sessions are unchanged.`,
    );
  }
}

export async function showConnection(
  local: OpenCodeClient,
  gitterm: GittermClient,
  record: HandoffRecord,
  signal: AbortSignal,
) {
  if (record.phase !== "ready" || !record.workspaceID) {
    throw new Error(
      `The last cloud handoff is ${record.phase}. ${record.workspaceID ? `Inspect workspace ${record.workspaceID} in GitTerm.` : `Look for attempt ${record.attemptID} in GitTerm.`} Local work is unchanged.`,
    );
  }
  await gitterm.workspaces.ensureRunning(record.workspaceID, { signal });
  const runtime = await gitterm.workspaces.getRuntimeAccess(record.workspaceID);
  const remote = runtimeClient(runtime);
  let connection = runtime.url!;
  let paired = false;
  if (new URL(connection).pathname === "/") {
    try {
      const pairing = await remote.server.pair({ signal });
      connection = `${connection.replace(/\/$/, "")}/auth/connect/${encodeURIComponent(pairing.code)}`;
      paired = true;
    } catch {
      /* Older runtimes can still be connected through the dashboard. */
    }
  }
  // Pairing codes live only in the user's form, never in durable chat history or storage.
  await askForm(
    local,
    record.sessionID,
    "Your cloud session is ready",
    [
      {
        key: "open",
        type: "external",
        url: connection,
        title: "Open cloud OpenCode",
        description: paired
          ? "One-time link; expires in five minutes. Alternatively paste into desktop Connect server."
          : "Sign in using the workspace credential from your GitTerm dashboard.",
      },
      {
        key: "done",
        type: "boolean",
        title: "Done",
        default: true,
        description: `Open session ${record.sessionID}. Workspace: ${record.workspaceID}. Run /cloud for a fresh connection to this same workspace. Later local changes are not synced. Local work is unchanged.`,
        required: true,
      },
    ],
    signal,
  );
}
