import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient } from "@gitterm/sdk";
import {
  askForm,
  HandoffCancelled,
  HandoffRefused,
  HISTORY_KEY,
  conversationDigest,
  importPayload,
  markCloudSession,
  NOTE_KEY,
  runRemoteShell,
  runtimeClient,
  sessionBusy,
  type HandoffRecord,
} from "./handoff";
import {
  CAPTURE_BUSY,
  CAPTURE_SCRIPT,
  CAPTURE_TOO_LARGE,
  CAPTURE_UNSUPPORTED,
  PREPARE_STAGE_SCRIPT,
  RESTORE_NEEDS_CONFIRMATION,
  RESTORE_NEEDS_FULL_HISTORY,
  RESTORE_SCRIPT,
  runLocalScript,
  shellQuote,
} from "./restore";
import { checkoutRoot, snapshotSummary } from "./snapshot";

export type ReturnDependencies = {
  local: OpenCodeClient;
  gitterm: GittermClient;
  signal: AbortSignal;
  save(record: HandoffRecord): Promise<void>;
  progress(text: string): Promise<void>;
};

/** What a return left behind of the local work it replaced. */
export type ReturnKept = {
  /** The replaced uncommitted changes are in a Git stash. */
  stash: boolean;
  /** The replaced local commits are on this branch. */
  branch: string | null;
  /** The replaced local conversation is in this session. */
  sessionID: string | null;
};

const VERIFIED = "GITTERM_HANDOFF_VERIFIED";
const CAPTURE_FAILURES: Record<number, string> = {
  [CAPTURE_UNSUPPORTED]:
    "The cloud checkout has merge conflicts, submodules, or untracked links, which cannot be brought back. Resolve them in the cloud first.",
  [CAPTURE_TOO_LARGE]:
    "The cloud's new commits and uncommitted changes exceed the 25 MiB limit. Push the branch from the cloud and pull it here instead.",
  [CAPTURE_BUSY]: "The cloud checkout changed while it was being captured. Try again.",
};

/**
 * Brings a session back from its cloud workspace: the cloud checkout's commits and
 * uncommitted changes replace the local checkout, and the cloud conversation replaces the
 * local one. Local work done since the handoff is only replaced after the user agrees, and
 * is kept (a stash, a branch, a copy of the conversation).
 */
export async function returnSession(
  record: HandoffRecord,
  deps: ReturnDependencies,
): Promise<{ record: HandoffRecord; kept: ReturnKept }> {
  const { local, gitterm, signal } = deps;
  const { sessionID, workspaceID } = record;
  if (record.phase !== "ready" || !workspaceID)
    throw new Error("This session is not in a cloud workspace. Run /cloud to move it there.");
  if (await sessionBusy(local, sessionID, signal))
    throw new Error(
      "Stop this session's local agent and finish or cancel its pending input before bringing the cloud session back.",
    );
  const session = await local.session.get({ sessionID }, { signal });
  const root = await checkoutRoot(await realpath(session.location.directory));
  if (root !== record.sourceDirectory)
    throw new Error("This session is no longer in the checkout it was handed off from.");

  let step = "connecting to the cloud workspace";
  const stage = `.gitterm-handoff-${record.attemptID}`;
  try {
    await deps.progress("Connecting to the cloud workspace.");
    await gitterm.workspaces.ensureRunning(workspaceID, { signal });
    const runtime = await gitterm.workspaces.getRuntimeAccess(workspaceID);
    const remote = runtimeClient(runtime);
    const atRest = async () => {
      if (await sessionBusy(remote, sessionID, signal))
        throw new HandoffRefused(
          "The cloud session is still working or has queued input. Let it finish or stop it there, then run /cloud-return again.",
        );
      return remote.session.export({ sessionID }, { signal });
    };
    const cloud = await atRest();

    step = "capturing the cloud checkout";
    await deps.progress("Capturing the cloud checkout.");
    // `base` is a commit this machine has, so only what the cloud added is downloaded.
    const capture = async (base: string) => {
      const run = (script: string, args: string[], accept: number[] = []) =>
        runRemoteShell(
          remote,
          runtime.directory,
          `node -e ${shellQuote(script)} ${args.map(shellQuote).join(" ")}`,
          signal,
          accept,
        );
      try {
        await run(PREPARE_STAGE_SCRIPT, [stage]);
        const exit = await run(
          CAPTURE_SCRIPT,
          // Everything in the cloud checkout comes back, so nothing is screened out.
          [stage, JSON.stringify({ base, changes: true })],
          Object.keys(CAPTURE_FAILURES).map(Number),
        );
        if (exit !== 0) throw new HandoffRefused(CAPTURE_FAILURES[exit]!);
        return await remote.file.read(
          { location: { directory: runtime.directory }, path: `${stage}/snapshot.bin` },
          { signal },
        );
      } finally {
        await runRemoteShell(
          remote,
          runtime.directory,
          `node -e ${shellQuote('require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })')} ${shellQuote(stage)}`,
          AbortSignal.timeout(10_000),
        ).catch(() => {});
      }
    };
    let snapshot = await capture(record.head);
    const summary = snapshotSummary(snapshot);
    // The conversation and the checkout must describe the same moment.
    if ((await atRest()).info.time.updated !== cloud.info.time.updated)
      throw new HandoffRefused("The cloud session changed while it was being captured. Try again.");

    const before = await local.session.export({ sessionID }, { signal });
    const localHistory = conversationDigest(before.messages);
    // Messages sent here after the handoff exist only in the local conversation.
    const diverged =
      localHistory !== record.history && localHistory !== conversationDigest(cloud.messages);
    if (diverged) {
      const answer = await askForm(
        local,
        sessionID,
        "Replace this conversation with the cloud's?",
        [
          {
            key: "replace",
            type: "boolean",
            title: "Bring the cloud conversation back?",
            required: true,
            description:
              "Messages were sent in this session after it moved to the cloud. The cloud conversation does not have them. They are kept in a copy of this session.",
          },
        ],
        signal,
      );
      if (answer.replace !== true) throw new HandoffCancelled();
    }

    step = "restoring the checkout on this machine";
    await deps.progress("Restoring the cloud checkout on this machine.");
    const restore = async (force: boolean) => {
      const directory = path.join(root, stage);
      try {
        await rm(directory, { recursive: true, force: true });
        await mkdir(directory, { mode: 0o700 });
        await writeFile(path.join(directory, "snapshot.bin"), snapshot, { mode: 0o600 });
        // An older record has no handed-off state to compare with: always ask first.
        return await runLocalScript(root, RESTORE_SCRIPT, [
          stage,
          "",
          record.state ?? "unknown",
          force ? "force" : "",
        ]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    let force = false;
    let full = false;
    let result = await restore(force);
    while (
      (result.exit === RESTORE_NEEDS_CONFIRMATION && !force) ||
      (result.exit === RESTORE_NEEDS_FULL_HISTORY && !full)
    ) {
      if (result.exit === RESTORE_NEEDS_CONFIRMATION) {
        const paths = summary.changedPaths.slice(0, 50).map((file) => JSON.stringify(file));
        const answer = await askForm(
          local,
          sessionID,
          "Replace your local changes with the cloud's?",
          [
            {
              key: "replace",
              type: "boolean",
              title: "Replace this checkout with the cloud checkout?",
              required: true,
              description: [
                "This checkout changed since the session moved to the cloud.",
                "Your uncommitted changes will be kept in a Git stash, and commits the cloud does not have on a gitterm/before-return branch.",
                `Cloud commit: ${summary.head}${summary.branch ? ` on ${summary.branch}` : ""}`,
                paths.length
                  ? `Uncommitted in the cloud (${summary.changedPaths.length}):\n${paths.join("\n")}`
                  : "The cloud has no uncommitted changes.",
              ].join("\n\n"),
            },
          ],
          signal,
        );
        if (answer.replace !== true) throw new HandoffCancelled();
        force = true;
      } else {
        // This machine no longer has the commit that was handed off: fetch everything.
        full = true;
        snapshot = await capture("");
        if (snapshotSummary(snapshot).digest !== summary.digest)
          throw new HandoffRefused(
            "The cloud checkout changed while it was being captured. Try again.",
          );
      }
      result = await restore(force);
    }
    if (result.exit !== 0 || !result.stdout.startsWith(VERIFIED))
      throw new HandoffRefused(
        "The cloud checkout could not be applied here, so this checkout was left as it was. A file ignored by Git may be in the way of one the cloud added.",
      );
    const kept: ReturnKept = {
      stash: false,
      branch: null,
      sessionID: null,
      ...(JSON.parse(result.stdout.slice(VERIFIED.length) || "{}") as Partial<ReturnKept>),
    };

    step = "bringing the conversation back";
    if (localHistory !== conversationDigest(cloud.messages)) {
      if (diverged) kept.sessionID = (await local.session.fork({ sessionID }, { signal })).id;
      await local.session.remove({ sessionID }, { signal });
      try {
        const payload = importPayload(cloud, session.location.directory);
        // The cloud copy's own bookkeeping does not belong on the local session.
        const { [HISTORY_KEY]: _digest, ...metadata } = payload.info.metadata ?? {};
        const imported = await local.session.import(
          { ...payload, info: { ...payload.info, metadata } },
          { signal },
        );
        if (imported.id !== sessionID) throw new Error("Session verification failed.");
      } catch (error) {
        // Put the local conversation back rather than leave this machine without one.
        await local.session
          .import(
            { ...before, location: before.info.location } as Parameters<
              OpenCodeClient["session"]["import"]
            >[0],
            { signal: AbortSignal.timeout(30_000) },
          )
          .catch(() => {});
        throw error;
      }
    }
    await local.session.synthetic(
      {
        sessionID,
        resume: false,
        metadata: { [NOTE_KEY]: record.attemptID },
        text: [
          `Returned from a cloud workspace to the local checkout ${root}.`,
          `Recent history ran in the cloud: absolute paths under ${runtime.directory} refer to that machine. Its commits and uncommitted changes are now in this checkout; processes it started are not running here.`,
        ].join("\n"),
      },
      { signal },
    );
    record.phase = "returned";
    await deps.save(record);
    // An imported conversation has no cloud label; one that needed no import still does.
    await markCloudSession(local, sessionID, undefined, signal).catch(() => {});
    return { record, kept };
  } catch (error) {
    if (error instanceof HandoffCancelled) throw error;
    console.error("GitTerm cloud return failed while", step, error);
    const reason =
      error instanceof GittermError || error instanceof HandoffRefused ? ` ${error.message}` : "";
    throw new Error(
      `Returning from the cloud failed while ${step}.${reason} The cloud workspace ${workspaceID} is unchanged and may still be running.`,
    );
  }
}

/**
 * Tells the user what came back and what was kept, then ends the cloud workspace. Its work
 * is here now, and a workspace left behind costs money, so it is deleted. Where the
 * provider and the plan allow it, the user is first asked whether to keep a snapshot of it
 * for this project: the next /cloud for the repository starts from that instead of from
 * scratch. Dismissing a question only pauses the workspace, because deleting cannot be undone.
 */
export async function finishReturn(
  local: OpenCodeClient,
  gitterm: GittermClient,
  record: HandoffRecord,
  kept: ReturnKept,
  signal: AbortSignal,
) {
  const workspaceID = record.workspaceID!;
  const came = [
    "The cloud's commits, uncommitted changes and conversation are now here.",
    kept.stash && "Your earlier uncommitted changes are in a Git stash (git stash list).",
    kept.branch && `Your earlier local commits are on the branch ${kept.branch}.`,
    kept.sessionID && `Your earlier local conversation is kept as session ${kept.sessionID}.`,
  ].filter(Boolean);
  const ask = (title: string, key: string, question: string, yes: boolean, detail: string) =>
    askForm(
      local,
      record.sessionID,
      // The terminal shows a single question's form title, not its field title.
      title,
      [
        {
          key,
          type: "boolean",
          title: question,
          default: yes,
          required: true,
          description: [...came, detail].join("\n\n"),
        },
      ],
      signal,
    ).then(
      (answer) => answer[key] === true,
      () => undefined,
    );

  // A workspace that cannot be kept as a snapshot is simply deleted or paused.
  const snapshot = await gitterm.workspaces.projectSnapshot(workspaceID).catch(() => undefined);
  if (!snapshot?.available) {
    const remove = await ask(
      "Back on this machine. Delete the cloud workspace?",
      "remove",
      "Delete the cloud workspace?",
      true,
      `Yes deletes workspace ${workspaceID} for good. Files Git ignores there, such as .env files and build output, did not come back and are deleted with it. No pauses it instead.`,
    );
    if (remove) await gitterm.workspaces.terminate(workspaceID);
    else await gitterm.workspaces.pause(workspaceID);
    return;
  }

  const keep = await ask(
    snapshot.existing
      ? "Back on this machine. Update this project's cloud snapshot?"
      : "Back on this machine. Keep a snapshot for this project's next cloud session?",
    "keep",
    "Keep a snapshot of the cloud workspace?",
    // Someone who kept one before most likely wants it kept up to date.
    Boolean(snapshot.existing),
    [
      snapshot.existing
        ? `Yes replaces the snapshot kept on ${snapshot.existing.createdAt.slice(0, 10)} with this workspace.`
        : "Yes keeps this workspace's disk as the snapshot for this repository. It counts towards your plan's snapshots.",
      "The next /cloud for this repository then starts from it, with the agent installed and the files Git ignores (installed dependencies, build output) in place. Saving can take a few minutes.",
      `Either way workspace ${workspaceID} is deleted. No deletes it without a snapshot.`,
    ].join(" "),
  );
  if (keep === undefined) {
    await gitterm.workspaces.pause(workspaceID);
    return;
  }
  if (!keep) {
    await gitterm.workspaces.terminate(workspaceID);
    return;
  }
  try {
    await gitterm.workspaces.terminate(workspaceID, { saveSnapshot: true });
  } catch (error) {
    // The work is already here, so the workspace still goes; only the snapshot is lost.
    await gitterm.workspaces.terminate(workspaceID);
    const reason = error instanceof GittermError ? ` ${error.message}` : "";
    throw new Error(
      `You are back on this machine and the cloud workspace is deleted, but its snapshot could not be saved.${reason}`,
    );
  }
}

/**
 * Asks before a message is sent in a session that lives in the cloud, and rejects the
 * message unless the user wants it sent here anyway.
 */
export async function confirmLocalPrompt(
  local: OpenCodeClient,
  record: HandoffRecord,
  signal: AbortSignal,
) {
  const answer = await askForm(
    local,
    record.sessionID,
    "This session is in the cloud. Send this message here anyway?",
    [
      {
        key: "send",
        type: "boolean",
        title: "Send this message here anyway?",
        required: true,
        description: `The conversation moved to cloud workspace ${record.workspaceID}. A message sent here is not seen there, and /cloud-return will ask before replacing it. Run /cloud to open the cloud session, or /cloud-return to bring it back.\n\nYes sends it here. No leaves it unsent.`,
      },
    ],
    signal,
  ).catch(() => ({ send: false }));
  if (answer.send !== true)
    throw new Error(
      "Not sent: this session continues in the cloud. Run /cloud to open it or /cloud-return to bring it back.",
    );
}
