import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  captureSnapshot,
  checkoutRoot,
  repositoryUrl,
  snapshotSummary,
} from "../../../opencode-cloud/src/snapshot.js";
import {
  CAPTURE_BUSY,
  CAPTURE_TOO_LARGE,
  CAPTURE_UNSUPPORTED,
  PREPARE_STAGE_SCRIPT,
  RESTORE_NEEDS_CONFIRMATION,
  RESTORE_NEEDS_FULL_HISTORY,
  RESTORE_SCRIPT,
  CAPTURE_SCRIPT,
  runLocalScript,
} from "../../../opencode-cloud/src/restore.js";
import {
  linkEnvironment,
  linkedEnvironments,
  saveRecord,
  threadLink,
  unlinkEnvironment,
  type MoveRecord,
} from "./local.js";
import type { Machine } from "./machine.js";

/** GitTerm, as these flows use it. Tests stand in a second local T3 server. */
export interface Cloud {
  /** Creates a T3 Code workspace and returns its id. Throws RepositoryUnreachable when it can't clone. */
  create(input: {
    name: string;
    repo?: string;
    branch?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<string>;
  /** Waits until it runs (resuming it if paused): its public URL and checkout directory. */
  ready(workspaceId: string): Promise<{ url: string; directory: string }>;
  machine(workspaceId: string): Machine;
  end(workspaceId: string, how: "pause" | "delete"): Promise<void>;
}

export class RepositoryUnreachable extends Error {}

export type Progress = (message: string) => void;

type Exported = {
  sessionId: string;
  providerInstanceId: string;
  cwd: string;
  title: string;
  model?: string;
  bytes: number;
  session: string;
  memory: Record<string, string>;
};

const VERIFIED = "GITTERM_HANDOFF_VERIFIED";
const CAPTURE_FAILURES: Record<number, string> = {
  [CAPTURE_UNSUPPORTED]:
    "The cloud checkout has merge conflicts, submodules, or untracked links, which cannot be brought back. Resolve them in the cloud first.",
  [CAPTURE_TOO_LARGE]:
    "The cloud's new commits and uncommitted changes exceed the 25 MiB limit. Push the branch from the cloud and pull it here instead.",
  [CAPTURE_BUSY]: "The cloud checkout changed while it was being captured. Try again.",
};

/** Creates the workspace from the repository, or from an upload when GitTerm can't clone it. */
async function createWorkspace(
  cloud: Cloud,
  root: string,
  changes: boolean,
  base: Omit<Parameters<Cloud["create"]>[0], "repo" | "idempotencyKey">,
  attempt: string,
) {
  const repo = await repositoryUrl(root);
  let snapshot = await captureSnapshot(root, changes);
  try {
    const id = await cloud.create({ ...base, repo, idempotencyKey: `t3-move:${attempt}` });
    return { id, snapshot, bundled: !repo };
  } catch (error) {
    if (!repo || !(error instanceof RepositoryUnreachable)) throw error;
    const full = await captureSnapshot(root, changes, true);
    if (full.digest !== snapshot.digest)
      throw new Error("The checkout changed while it was being copied. Try again.");
    snapshot = full;
    const id = await cloud.create({ ...base, idempotencyKey: `t3-move:${attempt}:bundled` });
    return { id, snapshot, bundled: true };
  }
}

/** Puts a checkout snapshot into a directory on a machine, all or nothing. */
async function restore(
  machine: Machine,
  directory: string,
  stage: string,
  encoded: Buffer,
  args: string[],
) {
  await machine.script(directory, PREPARE_STAGE_SCRIPT, [stage]);
  await machine.writeFile(path.posix.join(directory, stage, "snapshot.bin"), encoded);
  return machine.script(directory, RESTORE_SCRIPT, [stage, ...args]);
}

/**
 * Moves a T3 Code thread to a new GitTerm workspace: its checkout (commits origin lacks, and
 * uncommitted changes when asked) and its Claude Code session, which T3 Code there imports as
 * a thread that resumes the same conversation. The local thread is left as it was.
 */
export async function moveToCloud(
  deps: { cloud: Cloud; local: Machine; progress: Progress },
  options: {
    threadId: string;
    message?: string;
    changes: boolean;
    /** Set when the thread itself runs the move: its session is copied mid-turn. */
    fromThread: boolean;
    access?: string;
  },
) {
  const { cloud, local, progress } = deps;
  progress("Reading the thread");
  const exported = await local.t3<Exported>("export", {
    threadId: options.threadId,
    allowBusy: options.fromThread,
  });
  const root = await checkoutRoot(exported.cwd);
  const subpath = path.relative(root, exported.cwd).split(path.sep).join("/");
  const attempt = randomUUID();

  progress("Creating the cloud workspace");
  const created = await createWorkspace(
    cloud,
    root,
    options.changes,
    {
      name: exported.title.slice(0, 80) || "T3 Code thread",
      metadata: { "t3.thread": options.threadId.slice(0, 500), "t3.session": exported.sessionId },
    },
    attempt,
  );
  const workspaceId = created.id;
  const warnings: string[] = [];
  try {
    progress("Waiting for the workspace to start");
    const { url, directory } = await cloud.ready(workspaceId);
    const remote = cloud.machine(workspaceId);

    progress("Copying your code");
    const stage = `.gitterm-handoff-${attempt}`;
    let snapshot = created.snapshot;
    let result = await restore(remote, directory, stage, snapshot.encoded, [subpath]);
    if (result.exit === RESTORE_NEEDS_FULL_HISTORY) {
      const full = await captureSnapshot(root, options.changes, true);
      if (full.digest !== snapshot.digest)
        throw new Error("The checkout changed while it was being copied. Try again.");
      snapshot = full;
      result = await restore(remote, directory, stage, snapshot.encoded, [subpath]);
    }
    if (result.exit !== 0 || !result.stdout.includes(VERIFIED))
      throw new Error("The checkout could not be restored in the workspace.");

    progress("Copying the conversation");
    const cloudCwd = subpath ? path.posix.join(directory, subpath) : directory;
    const imported = await remote.t3<{
      threadId: string;
      sessionId: string;
      environmentId: string;
      serverVersion: string;
    }>("import", {
      session: exported.session,
      memory: exported.memory,
      cwd: cloudCwd,
      providerInstanceId: "claudeAgent",
    });
    const localInfo = await local.t3<{ serverVersion: string }>("info");
    if (localInfo.serverVersion !== imported.serverVersion)
      warnings.push(
        `T3 Code here is ${localInfo.serverVersion} and ${imported.serverVersion} in the workspace.`,
      );

    progress("Starting the agent in the cloud");
    await remote.t3("send", {
      threadId: imported.threadId,
      message: [
        `[GitTerm] This conversation moved from the user's machine (checkout ${root}) to a GitTerm cloud workspace. The working directory is now ${cloudCwd}.`,
        "Earlier messages ran on the user's machine: paths, processes and tool output in them describe that machine, and the command that moved you ended there.",
        options.changes
          ? "The checkout has the user's commits and uncommitted changes from when it moved."
          : "The checkout has the user's commits; uncommitted changes stayed behind.",
        ...(created.bundled
          ? [
              "GitTerm could not reach the repository's remote, so this checkout has none: git push and pull won't work here.",
            ]
          : []),
        "",
        options.message?.trim() ||
          "Continue the task you were working on. If it is done, say so briefly and wait.",
      ].join("\n"),
    });

    let linkedEnvironmentId: string | undefined;
    try {
      progress("Linking it to your T3 Code");
      const access = options.access ?? "full-access";
      const paired = await remote.t3<{ pairingCode: string }>("pair", { access, cwd: cloudCwd });
      linkedEnvironmentId = (await linkEnvironment(url, paired.pairingCode, access)).environmentId;
    } catch (error) {
      warnings.push(
        `Linking the workspace to your T3 Code failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let appLink: string | undefined;
    try {
      appLink = (await remote.t3<{ url: string }>("clientLink", { baseUrl: url })).url;
    } catch {
      /* The thread link still works through the linked environment. */
    }

    const record: MoveRecord = {
      workspaceId,
      localThreadId: options.threadId,
      localSessionId: exported.sessionId,
      localSessionBytes: exported.bytes,
      localCwd: exported.cwd,
      root,
      head: snapshot.head,
      state: snapshot.state,
      cloudThreadId: imported.threadId,
      cloudSessionId: imported.sessionId,
      cloudCwd,
      cloudDirectory: directory,
      environmentId: imported.environmentId,
      linkedEnvironmentId,
      movedAt: new Date().toISOString(),
    };
    await saveRecord(record);
    return {
      workspaceId,
      threadId: imported.threadId,
      environmentId: imported.environmentId,
      threadLink: threadLink(imported.environmentId, imported.threadId),
      appLink,
      url,
      warnings,
    };
  } catch (error) {
    await cloud.end(workspaceId, "delete").catch(() => {});
    throw error;
  }
}

/** Whether the user sent the local thread a message after this many bytes of its session. */
export function sentSince(session: string, bytes: number): boolean {
  return session
    .slice(bytes)
    .split("\n")
    .some((line) => {
      try {
        const record = JSON.parse(line) as {
          type?: string;
          isMeta?: boolean;
          isSidechain?: boolean;
          message?: { content?: unknown };
        };
        if (record.type !== "user" || record.isMeta || record.isSidechain) return false;
        const content = record.message?.content;
        if (typeof content === "string") return content.trim().length > 0;
        return (
          Array.isArray(content) &&
          content.some((block: { type?: string }) => block.type === "text") &&
          !content.some((block: { type?: string }) => block.type === "tool_result")
        );
      } catch {
        return false;
      }
    });
}

/**
 * Brings a moved thread back: the cloud checkout's commits and changes replace the local
 * checkout's, and the cloud conversation becomes the local thread's own session, so that
 * thread continues with everything the cloud did. Local work since the move is only
 * replaced with `force`, and is kept (a Git stash and branch, a copy of the session).
 */
export async function returnFromCloud(
  deps: { cloud: Cloud; local: Machine; progress: Progress },
  record: MoveRecord,
  options: { force: boolean; end: "pause" | "delete" | "keep"; message?: string },
) {
  const { cloud, local, progress } = deps;
  progress("Checking the local thread");
  const here = await local.t3<Exported>("export", { threadId: record.localThreadId });
  const localSession = gunzipSync(Buffer.from(here.session, "base64")).toString("utf8");
  if (!options.force && sentSince(localSession, record.localSessionBytes))
    throw new Error(
      "The local thread has messages from after the move, which bringing the cloud thread back would replace. Run again with --force to replace it anyway (a copy of its session is kept).",
    );

  progress("Connecting to the cloud workspace");
  const { directory } = await cloud.ready(record.workspaceId);
  const remote = cloud.machine(record.workspaceId);
  const cloudThread = await remote.t3<Exported>("export", { threadId: record.cloudThreadId });

  progress("Copying the cloud checkout");
  const stage = `.gitterm-handoff-${randomUUID()}`;
  const capture = async (base: string) => {
    try {
      await remote.script(directory, PREPARE_STAGE_SCRIPT, [stage]);
      const result = await remote.script(directory, CAPTURE_SCRIPT, [
        stage,
        JSON.stringify({ base, changes: true }),
      ]);
      if (result.exit !== 0)
        throw new Error(
          CAPTURE_FAILURES[result.exit] ?? "The cloud checkout could not be captured.",
        );
      return await remote.readFile(path.posix.join(directory, stage, "snapshot.bin"));
    } finally {
      await remote.remove(path.posix.join(directory, stage)).catch(() => {});
    }
  };
  let snapshot = await capture(record.head);
  const summary = snapshotSummary(snapshot);

  progress("Restoring it here");
  const restoreHere = async (force: boolean) => {
    const dir = path.join(record.root, stage);
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { mode: 0o700 });
      await writeFile(path.join(dir, "snapshot.bin"), snapshot, { mode: 0o600 });
      return await runLocalScript(record.root, RESTORE_SCRIPT, [
        stage,
        "",
        record.state,
        force ? "force" : "",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  let result = await restoreHere(options.force);
  if (result.exit === RESTORE_NEEDS_FULL_HISTORY) {
    snapshot = await capture("");
    if (snapshotSummary(snapshot).digest !== summary.digest)
      throw new Error("The cloud checkout changed while it was being captured. Try again.");
    result = await restoreHere(options.force);
  }
  if (result.exit === RESTORE_NEEDS_CONFIRMATION)
    throw new Error(
      "This checkout changed since the thread moved. Run again with --force to replace it with the cloud's (your changes are kept in a Git stash and a gitterm/before-return branch).",
    );
  if (result.exit !== 0 || !result.stdout.startsWith(VERIFIED))
    throw new Error(
      "The cloud checkout could not be applied here, so this checkout was left as it was. A file ignored by Git may be in the way of one the cloud added.",
    );

  progress("Bringing the conversation back");
  await local.t3("import", {
    threadId: record.localThreadId,
    session: cloudThread.session,
    memory: cloudThread.memory,
    cwd: record.localCwd,
  });
  await local.t3("send", {
    threadId: record.localThreadId,
    message: [
      `[GitTerm] This thread is back on the user's machine (checkout ${record.root}) from a GitTerm cloud workspace.`,
      `Messages since it moved ran in the cloud under ${record.cloudDirectory}; what they say about that machine was true there. The cloud's commits and uncommitted changes are now in this checkout; processes it started are not running here.`,
      "",
      options.message?.trim() ||
        "Briefly summarize what was done in the cloud and what is left, then wait.",
    ].join("\n"),
  });

  if (record.linkedEnvironmentId)
    await unlinkEnvironment(record.linkedEnvironmentId).catch(() => {});
  if (options.end !== "keep") await cloud.end(record.workspaceId, options.end);
  await saveRecord({ ...record, returnedAt: new Date().toISOString() });
  return {
    threadLink: threadLink(
      (await local.t3<{ environmentId: string }>("info")).environmentId,
      record.localThreadId,
    ),
  };
}

/**
 * A workspace for this repository linked to the local T3 Code, for agents here to hand tasks
 * to with delegate_task. Nothing moves: it clones the pushed branch.
 */
export async function createEnvironment(
  deps: { cloud: Cloud; progress: Progress },
  options: { name: string; repo?: string; branch?: string; access: string },
) {
  const { cloud, progress } = deps;
  progress("Creating the cloud workspace");
  const workspaceId = await cloud.create({
    name: options.name,
    repo: options.repo,
    branch: options.branch,
    metadata: { "t3.environment": "linked" },
    idempotencyKey: `t3-environment:${randomUUID()}`,
  });
  try {
    progress("Waiting for the workspace to start");
    const { url, directory } = await cloud.ready(workspaceId);
    progress("Linking it to your T3 Code");
    const paired = await cloud
      .machine(workspaceId)
      .t3<{ pairingCode: string; projectId: string }>("pair", {
        access: options.access,
        cwd: directory,
      });
    const linked = await linkEnvironment(url, paired.pairingCode, options.access);
    return { workspaceId, environmentId: linked.environmentId, projectId: paired.projectId, url };
  } catch (error) {
    await cloud.end(workspaceId, "delete").catch(() => {});
    throw error;
  }
}

/** Unlinks a workspace from the local T3 Code, then deletes or pauses it. */
export async function endEnvironment(
  cloud: Cloud,
  workspaceId: string,
  url: string | null,
  how: "pause" | "delete",
) {
  if (url) {
    const origin = new URL(url).origin;
    const linked = (await linkedEnvironments().catch(() => [])).find((environment) =>
      environment.urls.some((item) => URL.canParse(item) && new URL(item).origin === origin),
    );
    if (linked && how === "delete") await unlinkEnvironment(linked.environmentId);
  }
  await cloud.end(workspaceId, how);
}
