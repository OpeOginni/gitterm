import { realpath } from "node:fs/promises";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient } from "@gitterm/sdk";
import { opencodeAgent, opencodeMachine } from "@gitterm/move/agents/opencode";
import { checkoutRoot } from "@gitterm/move/checkout/snapshot";
import { ReturnDeclined, returnFromCloud } from "@gitterm/move/flows";
import { gittermCloud } from "@gitterm/move/gitterm";
import type { MoveRecord } from "@gitterm/move/records";
import { askForm, HandoffCancelled, markCloudSession } from "./handoff";

export type ReturnDependencies = {
  local: OpenCodeClient;
  gitterm: GittermClient;
  signal: AbortSignal;
  progress(text: string): Promise<void>;
};

/** What happens to the cloud workspace once its work is here. */
export type WorkspaceEnd = "delete" | "pause" | "snapshot";

/**
 * Brings a session back from its cloud workspace through the shared return flow
 * (`@gitterm/move/flows`): the cloud checkout's commits and uncommitted changes replace the
 * local checkout, and the cloud conversation replaces the local one. Local work done since
 * the move is only replaced after the user agrees, and is kept (a stash, a branch, a fork of
 * the conversation).
 */
export async function returnSession(
  moved: MoveRecord,
  deps: ReturnDependencies,
): Promise<{ end: WorkspaceEnd; cloudUnchanged(): Promise<boolean> }> {
  const { local, gitterm, signal } = deps;
  const { localRef: sessionID, workspaceId: workspaceID } = moved;
  const session = await local.session.get({ sessionID }, { signal });
  if ((await checkoutRoot(await realpath(session.location.directory))) !== moved.root)
    throw new Error("This session is no longer in the checkout it was moved from.");
  // Asked while nothing has changed yet, here in the session the user is looking at.
  const end = await askWorkspaceEnd(local, gitterm, moved, signal);

  // Asked when something here changed since the move. No cancels the return.
  const agrees = async (question: string, yes: string) =>
    (
      await askForm(
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
      )
    ).replace === "yes";

  let step = "connecting to the cloud workspace";
  try {
    const { cloudUnchanged } = await returnFromCloud(
      {
        cloud: gittermCloud(gitterm),
        local: opencodeMachine(local),
        agent: opencodeAgent,
        signal,
        progress: async (text) => {
          step = text.toLowerCase();
          await deps.progress(text);
        },
      },
      moved,
      {
        force: false,
        // The workspace ends after this, the way the user chose (see endWorkspace).
        end: "keep",
        confirm: {
          session: () =>
            agrees(
              "Replace this conversation with the cloud's?",
              "messages sent here since are kept in a copy of this session",
            ),
          checkout: () =>
            agrees(
              "Replace your local changes with the cloud's?",
              "yours are kept in a Git stash and a gitterm/before-return branch",
            ),
        },
      },
    );
    await markCloudSession(local, sessionID, undefined, signal).catch(() => {});
    return { end, cloudUnchanged };
  } catch (error) {
    if (error instanceof ReturnDeclined || signal.aborted) throw new HandoffCancelled();
    console.error("GitTerm cloud return failed while", step, error);
    const reason =
      error instanceof GittermError ||
      (error instanceof Error && !/https?:\/\//.test(error.message))
        ? ` ${error.message}`
        : "";
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
  record: MoveRecord,
  signal: AbortSignal,
): Promise<WorkspaceEnd> {
  const ask = async (question: string, yes: string, no: string) => {
    const answer = await askForm(
      local,
      record.localRef,
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
    .projectSnapshot(record.workspaceId)
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
  record: MoveRecord,
  signal: AbortSignal,
) {
  const answer = await askForm(
    local,
    record.localRef,
    "This session is in the cloud. Send this message here anyway?",
    [
      {
        key: "send",
        type: "boolean",
        title: "Send this message here anyway?",
        required: true,
        description: `The conversation moved to cloud workspace ${record.workspaceId}. A message sent here is not seen there, and /cloud-return will ask before replacing it. Run /cloud to open the cloud session, or /cloud-return to bring it back.\n\nYes sends it here. No leaves it unsent.`,
      },
    ],
    signal,
  ).catch(() => ({ send: false }));
  if (answer.send !== true)
    throw new Error(
      "Not sent: this session continues in the cloud. Run /cloud to open it or /cloud-return to bring it back.",
    );
}
