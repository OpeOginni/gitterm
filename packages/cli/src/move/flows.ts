import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
import type { AgentAdapter, ExportedSession } from "./agents/types.js";
import type { Machine } from "./machine.js";
import { saveRecord, type MoveRecord } from "./records.js";

/** GitTerm, as these flows use it. Tests stand in a second local agent home. */
export interface Cloud {
  /**
   * Creates a workspace running `agent` and returns its id. Throws RepositoryUnreachable when
   * it can't clone.
   */
  create(input: {
    agent: string;
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
    const id = await cloud.create({ ...base, repo, idempotencyKey: `move:${attempt}` });
    return { id, snapshot, bundled: !repo };
  } catch (error) {
    if (!repo || !(error instanceof RepositoryUnreachable)) throw error;
    const full = await captureSnapshot(root, changes, true);
    if (full.digest !== snapshot.digest)
      throw new Error("The checkout changed while it was being copied. Try again.");
    snapshot = full;
    const id = await cloud.create({ ...base, idempotencyKey: `move:${attempt}:bundled` });
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
 * Moves an agent's session to a new GitTerm workspace running the same agent: its checkout
 * (commits origin lacks, and uncommitted changes when asked) and its native session, which
 * the agent there resumes as the same conversation. The local session is left as it was.
 */
export async function moveToCloud(
  deps: { cloud: Cloud; local: Machine; agent: AgentAdapter; progress: Progress },
  options: {
    ref: string;
    message?: string;
    changes: boolean;
    /** Set when the session itself runs the move: it is copied mid-turn. */
    fromSession: boolean;
  },
) {
  const { cloud, local, agent, progress } = deps;
  progress("Reading the session");
  const exported = await local.agent<ExportedSession>(agent.script, "export", {
    ref: options.ref,
    allowBusy: options.fromSession,
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
      agent: agent.key,
      name: exported.title.slice(0, 80) || `${agent.label} session`,
      metadata: { "move.agent": agent.key, "move.session": exported.ref.slice(0, 500) },
    },
    attempt,
  );
  const workspaceId = created.id;
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
    const imported = await remote.agent<{ ref: string }>(agent.script, "import", {
      payload: exported.payload,
      cwd: cloudCwd,
    });
    const warnings: string[] = [];
    const [here, there] = await Promise.all([
      local.agent<{ version: string }>(agent.script, "info"),
      remote.agent<{ version: string }>(agent.script, "info"),
    ]);
    if (here.version !== there.version)
      warnings.push(
        `${agent.label} is ${here.version} here and ${there.version} in the workspace.`,
      );

    progress("Starting the agent in the cloud");
    await remote.agent(agent.script, "notify", {
      ref: imported.ref,
      where: "cloud",
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

    const connection = agent.connect
      ? await agent
          .connect({ local, remote, url, cwd: cloudCwd, ref: imported.ref })
          .catch((error: unknown) => ({
            links: {},
            warnings: [
              `Connecting the workspace to your ${agent.label} failed: ${error instanceof Error ? error.message : String(error)}`,
            ],
            state: undefined,
          }))
      : { links: {}, warnings: [], state: undefined };

    const record: MoveRecord = {
      workspaceId,
      agent: agent.key,
      localRef: exported.ref,
      localMark: exported.mark,
      localCwd: exported.cwd,
      root,
      head: snapshot.head,
      state: snapshot.state,
      cloudRef: imported.ref,
      cloudCwd,
      cloudDirectory: directory,
      ...(connection.state ? { connection: connection.state } : {}),
      movedAt: new Date().toISOString(),
    };
    await saveRecord(record);
    return {
      workspaceId,
      ref: imported.ref,
      url,
      links: connection.links,
      warnings: [...warnings, ...connection.warnings],
    };
  } catch (error) {
    await cloud.end(workspaceId, "delete").catch(() => {});
    throw error;
  }
}

/**
 * Brings a moved session back: the cloud checkout's commits and changes replace the local
 * checkout's, and the cloud conversation replaces the local session, so it continues with
 * everything the cloud did. Local work since the move is only replaced with `force`, and is
 * kept (a Git stash and branch, a copy of the session).
 */
export async function returnFromCloud(
  deps: { cloud: Cloud; local: Machine; agent: AgentAdapter; progress: Progress },
  record: MoveRecord,
  options: { force: boolean; end: "pause" | "delete" | "keep"; message?: string },
) {
  const { cloud, local, agent, progress } = deps;
  progress("Checking the local session");
  const here = await local.agent<ExportedSession>(agent.script, "export", {
    ref: record.localRef,
  });
  if (!options.force && agent.sentSince(here, record.localMark))
    throw new Error(
      "The local session has messages from after the move, which bringing the cloud session back would replace. Run again with --force to replace it anyway (a copy of it is kept).",
    );

  progress("Connecting to the cloud workspace");
  const { directory } = await cloud.ready(record.workspaceId);
  const remote = cloud.machine(record.workspaceId);
  const cloudSession = await remote.agent<ExportedSession>(agent.script, "export", {
    ref: record.cloudRef,
  });

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
      "This checkout, or the branch the cloud's work goes to, changed since the session moved. Run again with --force to replace it with the cloud's (your changes are kept in a Git stash and a gitterm/before-return branch).",
    );
  if (result.exit !== 0 || !result.stdout.startsWith(VERIFIED))
    throw new Error(
      "The cloud checkout could not be applied here, so this checkout was left as it was. A file ignored by Git may be in the way of one the cloud added.",
    );

  progress("Bringing the conversation back");
  await local.agent(agent.script, "import", {
    ref: record.localRef,
    payload: cloudSession.payload,
    cwd: record.localCwd,
  });
  // The checkout and conversation are back, so the return is done: run again, it would find
  // the cloud's messages here and refuse. The steps after this report a failure instead.
  await saveRecord({ ...record, returnedAt: new Date().toISOString() });
  const warnings: string[] = [];
  const warn = (what: string) => (error: unknown) => {
    warnings.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  };
  await local
    .agent(agent.script, "notify", {
      ref: record.localRef,
      where: "local",
      message: [
        `[GitTerm] This session is back on the user's machine (checkout ${record.root}) from a GitTerm cloud workspace.`,
        `Messages since it moved ran in the cloud under ${record.cloudDirectory}; what they say about that machine was true there. The cloud's commits and uncommitted changes are now in this checkout; processes it started are not running here.`,
        "",
        options.message?.trim() ||
          "Briefly summarize what was done in the cloud and what is left, then wait.",
      ].join("\n"),
    })
    .catch(warn("Could not start the session here"));

  if (record.connection && agent.disconnect)
    await agent.disconnect(record.connection).catch(() => {});
  if (options.end !== "keep")
    await cloud
      .end(record.workspaceId, options.end)
      .catch(
        warn(
          `Could not ${options.end} workspace ${record.workspaceId} (run gitterm ws ${options.end === "pause" ? "pause" : "terminate"} ${record.workspaceId})`,
        ),
      );
  return { ref: record.localRef, link: await agent.link?.(local, record.localRef), warnings };
}
