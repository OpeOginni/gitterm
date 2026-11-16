import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient } from "@gitterm/sdk";
import {
  askForm,
  HandoffCancelled,
  HandoffRefused,
  conversationDigest,
  importPayload,
  markCloudSession,
  runRemoteShell,
  runtimeClient,
  sessionBusy,
  tellMoved,
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

/** What happens to the cloud workspace once its work is here. */
export type WorkspaceEnd = "delete" | "pause" | "snapshot";

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
): Promise<{ record: HandoffRecord; end: WorkspaceEnd }> {
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
  // Asked while nothing has changed yet, here in the session the user is looking at.
  const end = await askWorkspaceEnd(local, gitterm, record, signal);

  // A question asked when something here changed since the handoff. No cancels the return.
  const askQuestion = async (question: string, yes: string) =>
    askForm(
      local,
      sessionID,
      "Bring this session back",
      [
        {
          key: "replace",
          type: "string",
          title: question,
          required: true,
          options: [
            { value: "yes", label: `Yes (${yes})` },
            { value: "no", label: "No (stops here, nothing changes)" },
          ],
        },
      ],
      signal,
    );

  let step = "connecting to the cloud workspace";
  const stage = `.gitterm-handoff-${record.attemptID}`;
  try {
    await deps.progress("Connecting to the cloud workspace");
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
    await deps.progress("Copying the cloud checkout");
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
      const answer = await askQuestion(
        "Replace this conversation with the cloud's?",
        "messages sent here since are kept in a copy of this session",
      );
      if (answer.replace !== "yes") throw new HandoffCancelled();
    }

    step = "restoring the checkout on this machine";
    await deps.progress("Restoring it on this machine");
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
        const answer = await askQuestion(
          "Replace your local changes with the cloud's?",
          "yours are kept in a Git stash and a gitterm/before-return branch",
        );
        if (answer.replace !== "yes") throw new HandoffCancelled();
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

    step = "bringing the conversation back";
    const replaced = localHistory !== conversationDigest(cloud.messages);
    if (replaced) {
      await deps.progress("Bringing the conversation back");
      // The questions before this told the user where their replaced work is kept.
      if (diverged) await local.session.fork({ sessionID }, { signal });
      await local.session.remove({ sessionID }, { signal });
      try {
        const imported = await local.session.import(
          importPayload(cloud, session.location.directory),
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
    await tellMoved(
      local,
      sessionID,
      [
        `This session moved back from a GitTerm cloud workspace to the user's machine (local checkout ${root}).`,
        `Messages from before this move, back to when the session went to the cloud, ran in the cloud workspace under ${runtime.directory}. What you said in them about the machine, paths or environment was true then; it is not a mistake.`,
        "The cloud's commits and uncommitted changes are now in this checkout; processes it started are not running here.",
      ],
      replaced,
      signal,
    );
    record.phase = "returned";
    await deps.save(record);
    // An imported conversation has no cloud label; one that needed no import still does.
    await markCloudSession(local, sessionID, undefined, signal).catch(() => {});
    return { record, end };
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
 * Asks what happens to the cloud workspace once its work is here. A workspace left behind
 * costs money, so it is deleted or paused. Where the provider and the plan allow it, a
 * snapshot of it can be kept for this project: the next /cloud for the repository starts
 * from that instead of from scratch. Dismissing the question cancels the return.
 */
export async function askWorkspaceEnd(
  local: OpenCodeClient,
  gitterm: GittermClient,
  record: HandoffRecord,
  signal: AbortSignal,
): Promise<WorkspaceEnd> {
  const ask = async (question: string, yes: string, no: string) => {
    const answer = await askForm(
      local,
      record.sessionID,
      "Bring this session back",
      [
        {
          key: "end",
          type: "string",
          title: question,
          required: true,
          options: [
            { value: "yes", label: `Yes (${yes})` },
            { value: "no", label: `No (${no})` },
          ],
        },
      ],
      signal,
    );
    return answer.end === "yes";
  };
  const snapshot = await gitterm.workspaces
    .projectSnapshot(record.workspaceID!)
    .catch(() => undefined);
  if (!snapshot?.available)
    return (await ask(
      "Delete the cloud workspace once it's back?",
      "deletes it for good, with files Git ignores there, such as .env",
      "pauses it",
    ))
      ? "delete"
      : "pause";
  return (await ask(
    snapshot.existing
      ? "Update this project's cloud snapshot?"
      : "Keep a snapshot for this project's next /cloud?",
    snapshot.existing
      ? `replaces the one from ${snapshot.existing.createdAt.slice(0, 10)}, then deletes the workspace`
      : "the next /cloud starts from it, then deletes the workspace",
    "deletes the workspace",
  ))
    ? "snapshot"
    : "delete";
}

/** Ends the cloud workspace the way the user chose. */
export async function endWorkspace(gitterm: GittermClient, workspaceID: string, end: WorkspaceEnd) {
  if (end === "pause") return gitterm.workspaces.pause(workspaceID);
  if (end === "delete") return gitterm.workspaces.terminate(workspaceID);
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
