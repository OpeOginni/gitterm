import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import type {
  GittermClient,
  WorkspaceProviderSelection,
  WorkspaceRuntimeAccess,
} from "@gitterm/sdk";
import { captureSnapshot, checkoutRoot, repositoryUrl, sharedCheckoutSessions } from "./snapshot";
import { RESTORE_SCRIPT, shellQuote } from "./restore";

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

export async function runRemoteShell(
  remote: OpenCodeClient,
  directory: string,
  command: string,
  signal: AbortSignal,
): Promise<void> {
  const location = { directory };
  let shell = (
    await remote.shell.create({ location, cwd: directory, command, timeout: 120_000 }, { signal })
  ).data;
  try {
    while (shell.status === "running") {
      await delay(300, undefined, { signal });
      shell = (await remote.shell.get({ id: shell.id, location }, { signal })).data;
    }
    if (shell.status !== "exited" || shell.exit !== 0) {
      throw new Error(
        "Cloud checkout restoration failed. The workspace is retained for inspection; local files are unchanged.",
      );
    }
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
    info: { ...info, location: { directory } },
    messages: data.messages,
    location: { directory },
  };
}

export async function handoffSession(
  sessionID: string,
  deps: HandoffDependencies,
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
          "Uploads this conversation (which may contain secrets) and Git history, including unpublished commits. Ignored files are not separately uploaded; tracked history can contain secrets. Review before approving.",
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
    attemptID: randomUUID(),
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
    const stage = `.gitterm-handoff-${record.attemptID}`;
    await deps.progress("Restoring and verifying the captured checkout in the cloud.");
    await runRemoteShell(
      remote,
      runtime.directory,
      `node -e ${shellQuote('require("node:fs").mkdirSync(process.argv[1], { mode: 0o700 })')} ${shellQuote(stage)}`,
      signal,
    );
    try {
      await remote.file.write(
        {
          location: { directory: runtime.directory },
          path: `${stage}/snapshot.json`,
          payload: Buffer.from(JSON.stringify(snapshot)),
        },
        { signal },
      );
      await runRemoteShell(
        remote,
        runtime.directory,
        `node -e ${shellQuote(RESTORE_SCRIPT)} ${shellQuote(stage)}`,
        signal,
      );
    } finally {
      // Remove only this attempt's temporary upload, including on cancellation.
      await runRemoteShell(
        remote,
        runtime.directory,
        `node -e ${shellQuote('require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })')} ${shellQuote(stage)}`,
        AbortSignal.timeout(10_000),
      ).catch(() => {});
    }
    const subpath = path.relative(root, sourceDirectory).split(path.sep).join("/");
    if (subpath.startsWith("../") || path.isAbsolute(subpath))
      throw new Error("The session moved outside its source checkout.");
    const directory = path.posix.join(runtime.directory, subpath);
    await runRemoteShell(
      remote,
      runtime.directory,
      `node -e ${shellQuote('require("node:fs").mkdirSync(process.argv[1], { recursive: true })')} ${shellQuote(directory)}`,
      signal,
    );
    record.phase = "importing";
    await deps.save(record);
    const imported = await remote.session.import(importPayload(exported, directory), { signal });
    if (imported.id !== sessionID || imported.location.directory !== directory)
      throw new Error("Cloud session verification failed.");
    await remote.session.synthetic(
      {
        sessionID,
        resume: false,
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
  } catch {
    record.phase = "failed";
    await deps.save(record);
    // Keep recovery metadata, but never retain snapshots, passwords, or upstream error bodies.
    throw new Error(
      `Cloud handoff failed${record.workspaceID ? ` for workspace ${record.workspaceID}` : ` (attempt ${record.attemptID})`}. Check GitTerm before retrying; a workspace may still be running and incurring charges. Local files and sessions are unchanged.`,
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
