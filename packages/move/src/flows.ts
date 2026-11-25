import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captureSnapshot,
  checkoutRoot,
  repositoryUrl,
  snapshotSummary,
} from "./checkout/snapshot.js";
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
} from "./checkout/restore.js";
import type { AgentAdapter, WorkspaceRuntime } from "./agents/types.js";
import type { Machine } from "./machine.js";
import { claimMove, loadRecords, saveRecord, type MoveRecord } from "./records.js";

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
  /**
   * Waits until it runs (resuming it if paused): how to reach its agent, and whether GitTerm
   * can run commands there.
   */
  ready(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceRuntime & { canExec: boolean }>;
  /** The workspace through GitTerm's command endpoint. */
  machine(workspaceId: string): Machine;
  end(workspaceId: string, how: "pause" | "delete"): Promise<void>;
  /** Whether the workspace was deleted. */
  gone(workspaceId: string): Promise<boolean>;
}

export class RepositoryUnreachable extends Error {}

export type Progress = (message: string) => void | Promise<void>;

/** Asked when a return would replace local work: true replaces it (a copy is kept). */
export type ReturnConfirmations = {
  /** The local session has messages from after the move. */
  session?(): Promise<boolean>;
  /** The local checkout changed since the move. */
  checkout?(): Promise<boolean>;
};

/** A return the user declined: nothing here changed. */
/** Why a returned session's workspace was left running. */
export const cloudWentOn = (workspaceId: string) =>
  `The cloud session went on after it was copied, so workspace ${workspaceId} was kept running with what it did since. Open it there, or end it with: gitterm ws terminate ${workspaceId}`;

export class ReturnDeclined extends Error {
  /** How the CLI reports it (`--json`), so a caller can ask and run again with --force. */
  readonly code = "NEEDS_CONFIRMATION";
}

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
    const full = await captureSnapshot(root, changes, true).catch((tooBig: Error) => {
      throw new Error(
        `GitTerm can't access this repository (${error.message}), and sending its whole history instead failed: ${tooBig.message} Give GitTerm access to the repository in the dashboard's Integrations, or push your branch, then try again.`,
        { cause: tooBig },
      );
    });
    if (full.digest !== snapshot.digest)
      throw new Error("The checkout changed while it was being copied. Try again.");
    snapshot = full;
    const id = await cloud.create({ ...base, idempotencyKey: `move:${attempt}:bundled` });
    return { id, snapshot, bundled: true };
  }
}

/** The workspace, through the agent's own server where it has one, else GitTerm's commands. */
function workspaceMachine(
  cloud: Cloud,
  agent: AgentAdapter,
  workspaceId: string,
  runtime: WorkspaceRuntime & { canExec: boolean },
): Machine {
  if (agent.remote) return agent.remote(runtime);
  if (!runtime.canExec)
    throw new Error(
      `GitTerm can't run commands in this workspace's provider, which moving a ${agent.label} session needs. Pick another provider.`,
    );
  return cloud.machine(workspaceId);
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
  deps: {
    cloud: Cloud;
    local: Machine;
    agent: AgentAdapter;
    progress: Progress;
    signal?: AbortSignal;
  },
  options: {
    ref: string;
    message?: string;
    changes: boolean;
    /** Set when the session itself runs the move: it is copied mid-turn. */
    fromSession: boolean;
    /** Stop a working session first (where the agent can), instead of refusing. */
    stopIfBusy?: boolean;
    /** The workspace's name; the session's title by default. */
    name?: string;
    /** Called once the workspace exists, before anything else happens in it. */
    created?(workspaceId: string): Promise<void>;
  },
) {
  // One workspace per session: a second move would bill a second one, so a move in flight
  // anywhere on this machine holds the session until its record is saved.
  const release = await claimMove(deps.agent.key, options.ref);
  try {
    return await moveOnce(deps, options);
  } finally {
    await release();
  }
}

async function moveOnce(
  deps: Parameters<typeof moveToCloud>[0],
  options: Parameters<typeof moveToCloud>[1],
) {
  const { cloud, local, agent, progress } = deps;
  // A move whose workspace was deleted has nothing to return, so it is closed.
  const open = (await loadRecords()).findLast(
    (record) => record.agent === agent.key && record.localRef === options.ref && !record.returnedAt,
  );
  if (open) {
    if (!(await cloud.gone(open.workspaceId)))
      throw new Error(
        `This session is already in cloud workspace ${open.workspaceId}. Continue it there, or bring it back with: gitterm return ${open.workspaceId}`,
      );
    await saveRecord({ ...open, returnedAt: new Date().toISOString() });
  }
  const here = agent.session(local);
  let stopped = false;
  if (!options.fromSession && options.stopIfBusy && here.stop) {
    if ((await here.status({ ref: options.ref })).busy) {
      await progress("Stopping the agent here");
      // Set first: a cancel while stopping must still let the agent carry on here.
      stopped = true;
      stopped = await here.stop({ ref: options.ref });
    }
  }
  try {
    const moved = await move({ ...deps, progress }, options, stopped);
    return { ...moved, stopped };
  } catch (error) {
    if (stopped)
      await here
        .notify({
          ref: options.ref,
          message: "Moving to the cloud was stopped. Continue where you left off.",
          where: "local",
        })
        .catch(() => {});
    throw error;
  }
}

async function move(
  deps: Parameters<typeof moveToCloud>[0],
  options: Parameters<typeof moveToCloud>[1],
  stopped: boolean,
) {
  const { cloud, local, agent, progress, signal } = deps;
  await progress("Reading the session");
  const exported = await agent.session(local).export({
    ref: options.ref,
    allowBusy: options.fromSession || stopped,
  });
  const root = await checkoutRoot(exported.cwd);
  const subpath = path.relative(root, exported.cwd).split(path.sep).join("/");
  const attempt = randomUUID();
  signal?.throwIfAborted();

  await progress("Creating the cloud workspace");
  const created = await createWorkspace(
    cloud,
    root,
    options.changes,
    {
      agent: agent.key,
      name: options.name ?? (exported.title.slice(0, 80) || `${agent.label} session`),
      metadata: { "move.agent": agent.key, "move.session": exported.ref.slice(0, 500) },
    },
    attempt,
  );
  const workspaceId = created.id;
  try {
    await options.created?.(workspaceId);
    signal?.throwIfAborted();
    await progress("Waiting for the workspace to start");
    const runtime = await cloud.ready(workspaceId, signal);
    const { url, directory } = runtime;
    const remote = workspaceMachine(cloud, agent, workspaceId, runtime);

    signal?.throwIfAborted();
    await progress("Copying your code");
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

    signal?.throwIfAborted();
    await progress("Copying the conversation");
    const cloudCwd = subpath ? path.posix.join(directory, subpath) : directory;
    const imported = await agent.session(remote).import({
      payload: exported.payload,
      cwd: cloudCwd,
    });
    const warnings: string[] = [];
    const [here, there] = await Promise.all([
      agent.session(local).info(),
      agent.session(remote).info(),
    ]);
    if (here.version !== there.version)
      warnings.push(
        `${agent.label} is ${here.version} here and ${there.version} in the workspace.`,
      );

    signal?.throwIfAborted();
    await progress("Starting the agent in the cloud");
    await agent.session(remote).notify({
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
  deps: {
    cloud: Cloud;
    local: Machine;
    agent: AgentAdapter;
    progress: Progress;
    signal?: AbortSignal;
  },
  record: MoveRecord,
  options: {
    force: boolean;
    end: "pause" | "delete" | "keep";
    message?: string;
    confirm?: ReturnConfirmations;
  },
) {
  const { cloud, local, agent, progress, signal } = deps;
  await progress("Checking the local session");
  const here = await agent.session(local).export({ ref: record.localRef });
  if (
    !options.force &&
    agent.sentSince(here, record.localMark) &&
    !(await options.confirm?.session?.())
  )
    throw new ReturnDeclined(
      "The local session has messages from after the move, which bringing the cloud session back would replace. Run again with --force to replace it anyway (a copy of it is kept).",
    );

  await progress("Connecting to the cloud workspace");
  const runtime = await cloud.ready(record.workspaceId, signal);
  const { directory } = runtime;
  const remote = workspaceMachine(cloud, agent, record.workspaceId, runtime);
  const there = agent.session(remote);
  // Where the agent can be stopped, nothing changes the session after this read.
  await there.hold?.({ ref: record.cloudRef });
  // Read before the export, so a change while it is read counts too.
  const revision = await there.revision?.({ ref: record.cloudRef }).catch(() => undefined);
  const cloudSession = await there.export({ ref: record.cloudRef });
  /** Whether the cloud session is still as it was read; anything it gained would go with the workspace. */
  const cloudUnchanged = async () =>
    revision === undefined
      ? (await there.export({ ref: record.cloudRef, allowBusy: true }).catch(() => undefined))
          ?.mark === cloudSession.mark
      : (await there.revision!({ ref: record.cloudRef }).catch(() => undefined)) === revision;

  await progress("Copying the cloud checkout");
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
  // A turn that ran while the checkout was copied would be missing from the conversation.
  const wentOn =
    revision === undefined
      ? (await there.export({ ref: record.cloudRef })).mark !== cloudSession.mark
      : !(await cloudUnchanged());
  if (wentOn)
    throw new Error(
      `The cloud ${agent.label} session went on while it was being copied. Try again once it is done.`,
    );

  await progress("Restoring it here");
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
  if (
    result.exit === RESTORE_NEEDS_CONFIRMATION &&
    !options.force &&
    (await options.confirm?.checkout?.())
  )
    result = await restoreHere(true);
  if (result.exit === RESTORE_NEEDS_CONFIRMATION)
    throw new ReturnDeclined(
      "This checkout, or the branch the cloud's work goes to, changed since the session moved. Run again with --force to replace it with the cloud's (your changes are kept in a Git stash and a gitterm/before-return branch).",
    );
  if (result.exit !== 0 || !result.stdout.startsWith(VERIFIED))
    throw new Error(
      "The cloud checkout could not be applied here, so this checkout was left as it was. A file ignored by Git may be in the way of one the cloud added.",
    );

  await progress("Bringing the conversation back");
  await agent.session(local).import({
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
  await agent
    .session(local)
    .notify({
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
  if (options.end !== "keep" && !(await cloudUnchanged()))
    warnings.push(cloudWentOn(record.workspaceId));
  else if (options.end !== "keep")
    await cloud
      .end(record.workspaceId, options.end)
      .catch(
        warn(
          `Could not ${options.end} workspace ${record.workspaceId} (run gitterm ws ${options.end === "pause" ? "pause" : "terminate"} ${record.workspaceId})`,
        ),
      );
  return {
    ref: record.localRef,
    link: await agent.link?.(local, record.localRef),
    warnings,
    cloudUnchanged,
  };
}
