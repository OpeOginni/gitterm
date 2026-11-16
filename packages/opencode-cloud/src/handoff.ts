import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
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
  git,
  repositoryUrl,
  sharedCheckoutSessions,
  type CheckoutSnapshot,
} from "./snapshot";
import { CLOUD_KEY, CONNECT_KEY, type CloudMarker } from "./marker";
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
  /** Env files, relative to the checkout root, whose variables the workspace gets. Later files win. */
  envFiles?: string[];
};

export type HandoffRecord = {
  attemptID: string;
  sessionID: string;
  /**
   * `moving`: /cloud is under way, or stopped without cleaning up (OpenCode was closed), and
   * the next /cloud deletes what it left. `ready`: the session lives in the cloud.
   * `returned`: it was brought back with /cloud-return. Older versions stored other phases;
   * they count as `moving`.
   */
  phase: "moving" | "ready" | "returned";
  workspaceID?: string;
  sourceDirectory: string;
  head: string;
  /** Digest of the local checkout's state as handed off; a return compares against it. */
  state?: string;
  /** Digest of the local conversation as handed off. */
  history?: string;
  includeChanges: boolean;
  createdAt: string;
};

type FormFields = Parameters<OpenCodeClient["session"]["form"]["create"]>[0]["fields"];
export type HandoffDependencies = {
  local: OpenCodeClient;
  gitterm: GittermClient;
  options: HandoffOptions;
  signal: AbortSignal;
  save(record: HandoffRecord): Promise<void>;
  /** Forgets the record of a /cloud that did not finish. */
  discard(record: HandoffRecord): Promise<void>;
  progress(text: string): Promise<void>;
};

/** A failure whose message is safe and useful to show the user as is. */
export class HandoffRefused extends Error {}

async function readEnvFiles(root: string, files: string[] = []) {
  const variables: Record<string, string> = Object.create(null);
  for (const file of files) {
    const content = await readFile(path.resolve(root, file), "utf8").catch(() => {
      throw new HandoffRefused(`Cannot read ${file} from the envFiles setting.`);
    });
    Object.assign(variables, parseEnv(content));
  }
  return variables;
}

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

export class HandoffCancelled extends Error {
  constructor() {
    super("Cloud handoff cancelled. Local files and sessions are unchanged.");
  }
}

export function changePrompt(sharedCount: number): string | undefined {
  return sharedCount > 0
    ? `${sharedCount} other active session(s) use this checkout. Their changes may be included too.`
    : undefined;
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

/** Refuses what cannot move to the cloud: running processes, and messages waiting to be sent. */
async function assertMovable(client: OpenCodeClient, sessionID: string, signal: AbortSignal) {
  const jobs = await client.experimental.job.list(
    { sessionID, status: "running", descendants: true },
    { signal },
  );
  if (jobs.some((job) => job.kind !== "subagent"))
    throw new HandoffRefused(
      "This session has background commands running. Let them finish or stop them first; running processes cannot move to the cloud.",
    );
  if (
    (await client.session.inbox.list({ sessionID }, { signal })).some(
      (item) => item.type === "user",
    )
  )
    throw new HandoffRefused(
      "This session has a message waiting to be sent. Let it run or remove it, then run /cloud again.",
    );
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
    if (Date.now() > deadline)
      throw new HandoffRefused("The agent did not stop. Stop it, then run /cloud again.");
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

/** Whether the checkout has uncommitted changes, untracked files included. */
async function hasChanges(root: string) {
  return (await git(root, ["status", "--porcelain", "--untracked-files=normal"])).length > 0;
}

/** Marks or unmarks the local session as living in a cloud workspace, for the UI to show. */
export async function markCloudSession(
  local: OpenCodeClient,
  sessionID: string,
  marker: CloudMarker | undefined,
  signal: AbortSignal,
) {
  await setSessionMetadata(local, sessionID, { [CLOUD_KEY]: marker }, signal);
}

export async function setSessionMetadata(
  local: OpenCodeClient,
  sessionID: string,
  values: Record<string, unknown>,
  signal: AbortSignal,
) {
  const metadata: Record<string, unknown> = {
    ...(await local.session.get({ sessionID }, { signal })).metadata,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  await local.session.update(
    { sessionID, metadata } as Parameters<OpenCodeClient["session"]["update"]>[0],
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

const INTEGRATION_KEYS = new Set(["github", "google", "gitlab", "bitbucket", "executor", "mcp"]);

/**
 * Connection references that do not point at a GitHub connection, with the server's
 * precedence: an integration key before a connection name. Only names and ids need the
 * connection list (scope `integrations:read`); without it they are kept and workspace
 * creation validates them as usual.
 */
export async function withoutGithub(
  gitterm: GittermClient,
  references: string[] | undefined,
): Promise<string[] | undefined> {
  if (!references?.length) return references;
  const key = (reference: string) => reference.trim().toLowerCase();
  const kept = references.filter((reference) => key(reference) !== "github");
  if (kept.every((reference) => INTEGRATION_KEYS.has(key(reference)))) return kept;
  const github = await gitterm.integrations.connections
    .list({ integration: "github" })
    .catch(() => []);
  return kept.filter((reference) => {
    const wanted = reference.trim();
    return (
      INTEGRATION_KEYS.has(key(reference)) ||
      !github.some((c) => c.id === wanted || c.name.toLowerCase() === key(reference))
    );
  });
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
    info: { ...info, location: { directory } },
    messages: data.messages,
    location: { directory },
  };
}

/** GitTerm's refusals when it can't read the repository; see createWorkspace on the server. */
const unreachableRepository = (error: GittermError) =>
  error.code === "BAD_REQUEST" &&
  /^(Can't access repository|Can't clone repository|The admin's shared GitHub token|Invalid repository URL)/.test(
    error.message,
  );

/** Continues the moved session in the cloud: with the user's message, or where it was stopped. */
export const CONTINUE_TEXT =
  "You were moved to a cloud workspace while working. Continue where you left off.";

/**
 * Moves the session to a new cloud workspace. A running agent is stopped first and continues
 * in the cloud; so does `message` when given. If anything fails or the user cancels, the
 * workspace is deleted and a stopped agent continues here, as if /cloud never ran.
 */
export async function handoffSession(
  sessionID: string,
  deps: HandoffDependencies,
  message = "",
): Promise<{ record: HandoffRecord; continuing: boolean }> {
  const { local, gitterm, options, signal } = deps;
  await assertMovable(local, sessionID, signal);
  const sourceDirectory = await realpath(
    (await local.session.get({ sessionID }, { signal })).location.directory,
  );
  const root = await checkoutRoot(sourceDirectory);
  let repo = await repositoryUrl(root);
  const environmentVariables = await readEnvFiles(root, options.envFiles);
  const envNames = Object.keys(environmentVariables);

  let includeChanges = false;
  if (await hasChanges(root)) {
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
      "Move to the cloud",
      [
        {
          key: "changes",
          type: "string",
          title: "Bring your uncommitted changes to the cloud?",
          description: changePrompt(shared.length),
          options: [
            { value: "yes", label: "Yes (copies your edited and new files)" },
            { value: "no", label: "No (starts from your last commit)" },
          ],
          required: true,
        },
      ],
      signal,
    );
    includeChanges = choice.changes === "yes";
  }

  let stopped = false;
  let step = "stopping the agent";
  const record: HandoffRecord = {
    attemptID: randomUUID(),
    sessionID,
    phase: "moving",
    sourceDirectory: root,
    head: "",
    includeChanges,
    createdAt: new Date().toISOString(),
  };
  try {
    if (await sessionBusy(local, sessionID, signal)) {
      await deps.progress("Stopping the agent here");
      // Set first: a cancel while stopping must still let the agent carry on here.
      stopped = true;
      stopped = await stopSession(local, sessionID, signal);
    }
    step = "capturing your checkout";
    const session = await local.session.get({ sessionID }, { signal });
    let snapshot = await captureSnapshot(root, includeChanges, !repo);
    const exported = await local.session.export({ sessionID }, { signal });
    if (exported.info.time.updated !== session.time.updated)
      throw new HandoffRefused("The session changed while it was being copied. Try again.");
    if (Buffer.byteLength(JSON.stringify(exported)) > 25 * 1024 * 1024)
      throw new HandoffRefused("Session history exceeds the 25 MiB handoff limit.");
    record.head = snapshot.head;
    record.state = snapshot.state;
    record.history = conversationDigest(exported.messages);

    step = "creating the cloud workspace";
    await deps.save(record);
    await deps.progress("Creating the cloud workspace");
    // Restore unpublished branches from the bundle, not the remote clone.
    let bundled = false;
    const create = async (useProjectSnapshot: boolean) =>
      gitterm.workspaces.create({
        // A failed snapshot start must not be reused for the fresh attempt.
        idempotencyKey: `opencode-handoff:${record.attemptID}${useProjectSnapshot ? "" : ":fresh"}${bundled ? ":bundled" : ""}`,
        name: options.name ?? session.title ?? "OpenCode cloud handoff",
        repo,
        agent: "opencode",
        provider: options.provider,
        persistent: options.persistent,
        // GitTerm rejects a GitHub connection on a workspace without a repository.
        connections: repo ? options.connections : await withoutGithub(gitterm, options.connections),
        metadata: { "opencode.handoff": record.attemptID, "opencode.session": sessionID },
        environmentVariables: envNames.length ? environmentVariables : undefined,
        useProjectSnapshot,
      });
    const createWorkspace = async () => {
      const created = await create(true).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes("PROJECT_SNAPSHOT_FAILED"))
          return undefined;
        throw error;
      });
      return !created || created.workspace.status === "terminated" ? create(false) : created;
    };
    const created = await createWorkspace().catch(async (error: unknown) => {
      if (!repo || !(error instanceof GittermError) || !unreachableRepository(error)) throw error;
      // Preserve the actionable repository error if a full upload is not possible.
      const full = await captureSnapshot(root, includeChanges, true).catch(() => {
        throw error;
      });
      if (full.digest !== snapshot.digest)
        throw new HandoffRefused("The checkout changed while it was being copied. Try again.");
      snapshot = full;
      repo = undefined;
      bundled = true;
      return createWorkspace();
    });
    record.workspaceID = created.workspace.id;
    await deps.save(record);
    step = "connecting to the cloud workspace";
    await gitterm.workspaces.ensureRunning(record.workspaceID, { signal });
    const runtime = await gitterm.workspaces.getRuntimeAccess(record.workspaceID);
    const remote = runtimeClient(runtime);
    await remote.server.info({ signal });
    const subpath = path.relative(root, sourceDirectory).split(path.sep).join("/");
    if (subpath.startsWith("../") || path.isAbsolute(subpath))
      throw new Error("The session moved outside its source checkout.");
    const directory = path.posix.join(runtime.directory, subpath);
    const stage = `.gitterm-handoff-${record.attemptID}`;

    step = "restoring your checkout in the cloud";
    await deps.progress("Copying your code");
    const restore = async (upload: CheckoutSnapshot) => {
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
      return runRemoteShell(
        remote,
        runtime.directory,
        `node -e ${shellQuote(RESTORE_SCRIPT)} ${shellQuote(stage)} ${shellQuote(subpath)}`,
        signal,
        [RESTORE_NEEDS_FULL_HISTORY],
      );
    };
    if ((await restore(snapshot)) === RESTORE_NEEDS_FULL_HISTORY) {
      // A full-history capture must still match the checkout the user approved.
      const full = await captureSnapshot(root, includeChanges, true);
      if (full.digest !== snapshot.digest)
        throw new HandoffRefused("The checkout changed while it was being copied. Try again.");
      if ((await restore(full)) !== 0) throw new Error("Cloud checkout restoration failed.");
    }

    step = "copying the conversation";
    await deps.progress("Copying the conversation");
    const keepModel = await cloudHasModel(
      gitterm,
      record.workspaceID,
      remote,
      directory,
      exported.info.model,
      signal,
    );
    const imported = await remote.session.import(
      importPayload(exported, directory, { keepModel }),
      { signal },
    );
    if (imported.id !== sessionID || imported.location.directory !== directory)
      throw new Error("Cloud session verification failed.");
    await tellMoved(
      remote,
      sessionID,
      [
        `This session moved from the user's machine (local checkout ${root}) to a GitTerm cloud workspace. The working directory is now ${directory}.`,
        "Messages from before this move ran on the user's machine. What you said in them about the machine, paths or environment was true then; it is not a mistake.",
        includeChanges
          ? "The checkout includes uncommitted local changes, potentially from other sessions."
          : "Uncommitted local changes were left behind; do not assume edits described in history exist here.",
        ...(bundled
          ? [
              "GitTerm could not reach the repository's remote, so this checkout was copied without one: git push and pull won't work here.",
            ]
          : []),
        "Absolute paths in earlier history refer to the old machine. Local processes, ignored files, credential stores, and global plugins/configuration did not come along; repository-owned configuration did. Select an available cloud model/agent if needed.",
      ],
      true,
      signal,
    );

    step = "starting the agent in the cloud";
    if (message) await remote.session.prompt({ sessionID, text: message }, { signal });
    else if (stopped)
      await remote.session.synthetic({ sessionID, text: CONTINUE_TEXT, resume: true }, { signal });
    record.phase = "ready";
    await deps.save(record);
    await markCloudSession(local, sessionID, { workspaceID: record.workspaceID }, signal).catch(
      () => {},
    );
    return { record, continuing: Boolean(message) || stopped };
  } catch (error) {
    // Undo what this attempt did, so nothing is left running or half moved.
    const cleanup = AbortSignal.timeout(30_000);
    const deleted = record.workspaceID
      ? await gitterm.workspaces.terminate(record.workspaceID).then(
          () => true,
          () => false,
        )
      : true;
    if (deleted) await deps.discard(record).catch(() => {});
    if (stopped)
      await local.session
        .synthetic(
          {
            sessionID,
            text: "Moving to the cloud was stopped. Continue where you left off.",
            resume: true,
          },
          { signal: cleanup },
        )
        .catch(() => {});
    if (signal.aborted || error instanceof HandoffCancelled) throw new HandoffCancelled();
    // Responses may echo credentials or snapshots; show only GitTerm's redacted reason.
    console.error("GitTerm cloud handoff failed while", step, error);
    const reason =
      error instanceof GittermError || error instanceof HandoffRefused ? ` ${error.message}` : "";
    const workspace = !record.workspaceID
      ? ""
      : deleted
        ? " The cloud workspace was deleted."
        : ` Workspace ${record.workspaceID} could not be deleted: delete it in GitTerm.`;
    throw new Error(
      `Moving to the cloud failed while ${step}.${reason}${workspace} Local files and sessions are unchanged; run /cloud to try again.`,
    );
  }
}

/** Sends a message to the session in its cloud workspace, as if typed there. */
export async function sendToCloud(
  gitterm: GittermClient,
  record: HandoffRecord,
  text: string,
  signal: AbortSignal,
) {
  const remote = runtimeClient(await gitterm.workspaces.getRuntimeAccess(record.workspaceID!));
  await remote.session.prompt({ sessionID: record.sessionID, text }, { signal });
}

/** `working`: the cloud agent was just given something to do. */
export async function showConnection(
  local: OpenCodeClient,
  gitterm: GittermClient,
  record: HandoffRecord,
  signal: AbortSignal,
  working = false,
) {
  const runtime = await gitterm.workspaces.getRuntimeAccess(record.workspaceID!);
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
    working ? "The agent is working in the cloud" : "Your cloud session is ready",
    [
      {
        key: CONNECT_KEY,
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
