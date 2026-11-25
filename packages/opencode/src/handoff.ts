import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import type { OpenCodeClient } from "@opencode/client";
import { GittermError, type GittermClient, type WorkspaceProviderSelection } from "@gitterm/sdk";
import { checkoutRoot, git, sharedCheckoutSessions } from "@gitterm/move/checkout/snapshot";
import { CLOUD_KEY, CONNECT_KEY, type CloudMarker } from "./marker.js";
import { opencodeAgent, opencodeMachine } from "@gitterm/move/agents/opencode";
import { moveToCloud } from "@gitterm/move/flows";
import { gittermCloud } from "@gitterm/move/gitterm";
import { runtimeClient } from "@gitterm/move/agents/opencode-session";
import type { MoveRecord } from "@gitterm/move/records";

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

type FormFields = Parameters<OpenCodeClient["session"]["form"]["create"]>[0]["fields"];
export type HandoffDependencies = {
  local: OpenCodeClient;
  gitterm: GittermClient;
  options: HandoffOptions;
  signal: AbortSignal;
  progress(text: string): Promise<void>;
};

/** A failure whose message is safe and useful to show the user as is. */
export class HandoffRefused extends Error {}

/** GitTerm's web app: gitterm.dev for api.gitterm.dev; a self-hosted server serves both. */
export function dashboardUrl(serverUrl: string, pathname: string): string {
  const url = new URL(serverUrl);
  if (url.hostname.startsWith("api.")) url.hostname = url.hostname.slice(4);
  return new URL(pathname, url.origin).href;
}

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
 * Moves a session to a new GitTerm workspace through the shared move flow
 * (`@gitterm/move/flows`), which records the move for /cloud-return, the CLI and the status.
 * This plugin only asks what to bring and says what failed. If anything fails, the workspace
 * is deleted and a stopped agent continues here, as if /cloud never ran.
 */
export async function handoffSession(
  sessionID: string,
  deps: HandoffDependencies,
  message = "",
): Promise<{ workspaceID: string }> {
  const { local, gitterm, options, signal } = deps;
  await assertMovable(local, sessionID, signal);
  const sourceDirectory = await realpath(
    (await local.session.get({ sessionID }, { signal })).location.directory,
  );
  const root = await checkoutRoot(sourceDirectory);
  const environmentVariables = await readEnvFiles(root, options.envFiles);

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

  let workspaceID: string | undefined;
  let step = "copying the session";
  try {
    const moved = await moveToCloud(
      {
        cloud: gittermCloud(gitterm, {
          provider: options.provider,
          persistent: options.persistent,
          connections: options.connections,
          environmentVariables,
          projectSnapshots: true,
        }),
        local: opencodeMachine(local),
        agent: opencodeAgent,
        signal,
        progress: async (text) => {
          step = text.toLowerCase();
          await deps.progress(text);
        },
      },
      {
        ref: sessionID,
        message,
        changes: includeChanges,
        fromSession: false,
        stopIfBusy: true,
        name: options.name,
        created: async (id) => {
          workspaceID = id;
        },
      },
    );
    await markCloudSession(local, sessionID, { workspaceID: moved.workspaceId }, signal).catch(
      () => {},
    );
    return { workspaceID: moved.workspaceId };
  } catch (error) {
    // The flow deleted any workspace it created.
    if (signal.aborted) throw new HandoffCancelled();
    // Responses may echo credentials or snapshots; show only GitTerm's redacted reason.
    console.error("GitTerm cloud handoff failed while", step, error);
    const reason =
      error instanceof GittermError || error instanceof HandoffRefused
        ? ` ${error.message}`
        : error instanceof Error && !/https?:\/\//.test(error.message)
          ? ` ${error.message}`
          : "";
    const deleted = workspaceID ? " The cloud workspace was deleted." : "";
    throw new Error(
      `Moving to the cloud failed while ${step}.${reason}${deleted} Local files and sessions are unchanged; run /cloud to try again.`,
    );
  }
}

/** Sends a message to the session in its cloud workspace, as if typed there. */
export async function sendToCloud(
  gitterm: GittermClient,
  record: MoveRecord,
  text: string,
  signal: AbortSignal,
) {
  const remote = runtimeClient(await gitterm.workspaces.getRuntimeAccess(record.workspaceId));
  await remote.session.prompt({ sessionID: record.cloudRef, text }, { signal });
}

/**
 * Shows the link to the cloud session in the local session `sessionID`. `working`: the cloud
 * agent was just given something to do.
 */
export async function showConnection(
  local: OpenCodeClient,
  gitterm: GittermClient,
  sessionID: string,
  workspaceID: string,
  signal: AbortSignal,
  working = false,
) {
  const runtime = await gitterm.workspaces.getRuntimeAccess(workspaceID);
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
    sessionID,
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
        description: `Open session ${sessionID}. Workspace: ${workspaceID}. Run /cloud for a fresh connection to this same workspace. Later local changes are not synced. Local work is unchanged.`,
        required: true,
      },
    ],
    signal,
  );
}
