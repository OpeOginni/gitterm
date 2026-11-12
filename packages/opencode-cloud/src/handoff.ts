import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import {
  GittermError,
  PASSIVE_REQUEST_HEADER,
  type GittermClient,
  type WorkspaceProviderSelection,
  type WorkspaceRuntimeAccess,
} from "@gitterm/sdk";
import {
  captureSnapshot,
  checkoutRoot,
  repositoryUrl,
  sharedCheckoutSessions,
  type CheckoutSnapshot,
} from "./snapshot";
import { CLOUD_KEY, type CloudMarker } from "./marker";
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
  /** `ready`: the session lives in the cloud. `returned`: it was brought back with /cloud-return. */
  phase: "creating" | "restoring" | "importing" | "ready" | "returned" | "failed";
  workspaceID?: string;
  sourceDirectory: string;
  head: string;
  /** Digest of the local checkout's state as handed off; a return compares against it. */
  state?: string;
  /** Digest of the local conversation as handed off. */
  history?: string;
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
  returned: "finishing",
  failed: "finishing",
};

/** A failure whose message is safe and useful to show the user as is. */
export class HandoffRefused extends Error {}

/** Session metadata key holding the digest of the history a handoff imported. */
export const HISTORY_KEY = "gittermHandoffHistory";
/** Metadata key on the note a handoff or a return leaves in a session's pending input. */
export const NOTE_KEY = "gittermHandoff";
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
export const historyDigest = (messages: unknown) =>
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

export async function assertIdle(client: OpenCodeClient, sessionID: string, signal: AbortSignal) {
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
  if (!(await client.session.inbox.list({ sessionID }, { signal })).every(ownNote)) {
    throw new Error(
      "This session has pending input. Finish or cancel it before continuing in the cloud.",
    );
  }
}

/** A note a handoff or a return left in a session's pending input; it is not the user's. */
const ownNote = (item: Awaited<ReturnType<OpenCodeClient["session"]["inbox"]["list"]>>[number]) =>
  item.type === "synthetic" && item.payload.metadata?.[NOTE_KEY] !== undefined;

/**
 * Whether a session is doing or waiting to do something: a running agent, running
 * background jobs, or queued input. Notes a handoff or return left there do not count.
 */
export async function sessionBusy(
  client: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
): Promise<boolean> {
  const jobs = await client.experimental.job.list(
    { sessionID, status: "running", descendants: true },
    { signal },
  );
  return (
    Boolean((await client.session.active({ signal }))[sessionID]) ||
    jobs.length > 0 ||
    !(await client.session.inbox.list({ sessionID }, { signal })).every(ownNote)
  );
}

/** Marks or unmarks the local session as living in a cloud workspace, for the UI to show. */
export async function markCloudSession(
  local: OpenCodeClient,
  sessionID: string,
  marker: CloudMarker | undefined,
  signal: AbortSignal,
) {
  const { [CLOUD_KEY]: _marker, ...metadata } =
    (await local.session.get({ sessionID }, { signal })).metadata ?? {};
  await local.session.update(
    { sessionID, metadata: marker ? { ...metadata, [CLOUD_KEY]: marker } : metadata },
    { signal },
  );
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

/** Checks workspace credentials before waiting for unmanaged models in the cloud catalog. */
export async function cloudHasModel(
  gitterm: GittermClient,
  workspaceID: string,
  remote: OpenCodeClient,
  directory: string,
  model: { providerID: string; id: string } | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  if (!model) return true;
  const connected = await gitterm.workspaces.models(workspaceID).then(
    (access) =>
      access.providers.some((entry) => entry.active && entry.provider === model.providerID),
    // An older GitTerm server: the catalog alone decides.
    () => false,
  );
  return connected || offersModel(remote, directory, model, signal);
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
    // The terminal shows a single question's form title, not its field title, so the
    // title is the question.
    "Continue in the cloud. Include your uncommitted changes?",
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
  const snapshot = await captureSnapshot(root, includeChanges, !repo);
  const manifest = snapshot.changedPaths
    .slice(0, 100)
    .map((file) => JSON.stringify(file))
    .join("\n");
  const confirmation = await askForm(
    local,
    sessionID,
    "Upload this snapshot and start billable cloud compute?",
    [
      {
        key: "create",
        type: "boolean",
        title: "Upload this snapshot and start billable cloud compute?",
        required: true,
        default: false,
        description: [
          `Repository: ${repo ?? "this checkout only (no origin)"}\nCommit: ${snapshot.head}\nSnapshot: ${(snapshot.bytes / 1024 / 1024).toFixed(2)} MiB`,
          includeChanges
            ? `${snapshot.changedPaths.length} changed paths${manifest ? `:\n${manifest}` : ""}${snapshot.changedPaths.length > 100 ? "\n(additional paths omitted)" : ""}`
            : "Uncommitted changes are excluded.",
          `Uploads this conversation (which may contain secrets) and ${repo ? "commits that are not on origin's default branch, including unpublished ones" : "the repository's whole history"}. Ignored files are not separately uploaded; tracked history can contain secrets. Review before approving.`,
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
    state: snapshot.state,
    history: conversationDigest(exported.messages),
    includeChanges,
    sharedSessions: shared.length,
    createdAt: new Date().toISOString(),
  };
  await deps.save(record);
  try {
    await deps.progress(
      "Creating a GitTerm workspace. Your local checkout and sessions remain unchanged.",
    );
    // Restore unpublished branches from the bundle, not the remote clone.
    const create = (useProjectSnapshot: boolean) =>
      gitterm.workspaces.create({
        // A failed snapshot start must not be reused for the fresh attempt.
        idempotencyKey: `opencode-handoff:${record.attemptID}${useProjectSnapshot ? "" : ":fresh"}`,
        name: options.name ?? session.title ?? "OpenCode cloud handoff",
        repo,
        agent: "opencode",
        provider: options.provider,
        persistent: options.persistent,
        connections: repo
          ? options.connections
          : options.connections?.filter((name) => name !== "github"),
        metadata: { "opencode.handoff": record.attemptID, "opencode.session": sessionID },
        useProjectSnapshot,
      });
    let created = await create(true).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("PROJECT_SNAPSHOT_FAILED"))
        return undefined;
      throw error;
    });
    if (!created || created.workspace.status === "terminated") created = await create(false);
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
            payload: upload.encoded,
          },
          { signal },
        );
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
        // The restore script cleans up on completion; interruptions leave the upload behind.
        if (!finished)
          await runRemoteShell(
            remote,
            runtime.directory,
            `node -e ${shellQuote('require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })')} ${shellQuote(stage)}`,
            AbortSignal.timeout(10_000),
          ).catch(() => {});
      }
    };
    // Refuse retries before touching the checkout if the imported session has new activity.
    const untouchedSession = async () => {
      let earlier;
      try {
        earlier = await remote.session.export({ sessionID }, { signal });
      } catch (error) {
        // Only a missing session is safe to replace; other errors could hide cloud work.
        const missing =
          error instanceof Error &&
          error.name === "SessionNotFoundError" &&
          (error as { sessionID?: unknown }).sessionID === sessionID;
        if (missing) return undefined;
        throw error;
      }
      if (
        earlier.info.metadata?.[HISTORY_KEY] !== historyDigest(earlier.messages) ||
        (await sessionBusy(remote, sessionID, signal))
      )
        throw new HandoffRefused(
          "The cloud session has new activity since the earlier attempt, so the cloud was left as it is. Continue it in the cloud, or start a new handoff.",
        );
      return earlier;
    };
    const found = await untouchedSession();
    if ((await restore(snapshot)) === RESTORE_NEEDS_FULL_HISTORY) {
      // A full-history retry must still match the checkout the user approved.
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
      const keepModel = await cloudHasModel(
        gitterm,
        record.workspaceID!,
        remote,
        directory,
        exported.info.model,
        signal,
      );
      imported = await remote.session.import(importPayload(exported, directory, { keepModel }), {
        signal,
      });
    } catch (error) {
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
    await markCloudSession(local, sessionID, { workspaceID: record.workspaceID }, signal).catch(
      () => {},
    );
    return record;
  } catch (error) {
    const step = STEPS[record.phase];
    record.phase = "failed";
    await deps.save(record);
    // Responses may echo credentials or snapshots; show only GitTerm's redacted reason.
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
