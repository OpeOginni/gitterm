import { and, db, eq, inArray } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspaceSetup } from "@gitterm/db/schema/workspace-setup";
import { getProviderByCloudProviderId } from "../providers";
import type { DaytonaConfig } from "../providers/daytona/types";
import { getWorkspaceUrl } from "../utils/routing";
import { decryptWorkspacePassword } from "../utils/workspace-password";
import { createWorkspaceOpencodeClient } from "./agent-run/opencode";
import { getProviderConfigService } from "./config/provider-config";
import { resolveProjectDirectory } from "./workspace-runtime";

/**
 * Pull-based fallback for the `afterAgent` setup phase.
 *
 * The setup wrapper always writes its state to files inside the workspace
 * before attempting to POST a report to the API. When those reports cannot
 * arrive — Daytona Tier 1/2 egress rules, a misconfigured WORKSPACE_API_URL,
 * a wrapper that never started — we read the files ourselves:
 *
 * - Daytona: over the provider's exec channel.
 * - Any OpenCode server workspace (Railway, AWS, ...): through the OpenCode
 *   file API, which is reachable whenever the agent itself is.
 *
 * If nothing has been heard for STALL_AFTER_MS and the files show the wrapper
 * never got past `waiting`, the setup is marked failed with a reason, so
 * callers waiting on it fail fast instead of hanging.
 *
 * Resource discipline: polling is demand-driven (runs only while someone is
 * actively asking for setup status), throttled per workspace, and skipped
 * entirely once the setup reaches a terminal state.
 */

const POLL_MIN_INTERVAL_MS = 10_000;
const READ_TIMEOUT_MS = 15_000;
const THROTTLE_ENTRY_TTL_MS = 10 * 60_000;
/** Readiness probe inside the wrapper gives up after 5 minutes; allow for slow starts on top. */
export const SETUP_STALL_AFTER_MS = 15 * 60_000;

const SETUP_RELATIVE_DIR = ".gitterm/setup/after-agent";

const lastPollAt = new Map<string, number>();

type SetupFileState = "absent" | "waiting" | "running" | "succeeded" | "failed" | "unknown";

type SetupMarkers = {
  state: SetupFileState;
  exitCode: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  log: string | null;
};

function shouldPollNow(workspaceId: string): boolean {
  const now = Date.now();
  const last = lastPollAt.get(workspaceId) ?? 0;
  if (now - last < POLL_MIN_INTERVAL_MS) return false;
  lastPollAt.set(workspaceId, now);
  if (lastPollAt.size > 1_000) {
    for (const [id, at] of lastPollAt) {
      if (now - at > THROTTLE_ENTRY_TTL_MS) lastPollAt.delete(id);
    }
  }
  return true;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseIsoDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseState(raw: string | undefined | null): SetupFileState {
  const state = raw?.trim();
  if (state === "waiting" || state === "running" || state === "succeeded" || state === "failed") {
    return state;
  }
  return state ? "unknown" : "absent";
}

function toMarkers(files: {
  state?: string | null;
  exitCode?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  log?: string | null;
}): SetupMarkers {
  const exitCodeRaw = Number.parseInt(files.exitCode ?? "", 10);
  return {
    state: parseState(files.state),
    exitCode: Number.isInteger(exitCodeRaw) ? exitCodeRaw : null,
    startedAt: parseIsoDate(files.startedAt?.trim()),
    finishedAt: parseIsoDate(files.finishedAt?.trim()),
    log: files.log ? files.log.replaceAll("\0", "").slice(-50_000) : null,
  };
}

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide whether a non-terminal setup has stalled. Pure so it can be tested:
 * a wrapper still `running` a long install is fine; one that never reported
 * and never progressed past `waiting` within the window is not.
 */
export function stalledSetupReason(input: {
  createdAt: Date;
  now: Date;
  state: SetupFileState | "unreadable";
}): string | null {
  if (input.now.getTime() - input.createdAt.getTime() < SETUP_STALL_AFTER_MS) return null;
  const minutes = Math.round(SETUP_STALL_AFTER_MS / 60_000);
  switch (input.state) {
    case "absent":
      return `No setup state was found in the workspace after ${minutes} minutes: the afterAgent setup wrapper never started. Check the container's startup logs and confirm the image entrypoint launches gitterm-workspace-setup.`;
    case "waiting":
      return `Setup was still waiting for the agent to answer on its local port after ${minutes} minutes, even though the workspace is reachable externally. Check that the agent listens on WORKSPACE_SETUP_PORT inside the container.`;
    case "unreadable":
      return `No setup status report was received within ${minutes} minutes and the workspace could not be inspected. Check that WORKSPACE_API_URL is reachable from the workspace and that the setup token is accepted.`;
    default:
      return null;
  }
}

async function readMarkersViaExec(
  externalInstanceId: string,
  directory: string,
): Promise<SetupMarkers | null> {
  const computeProvider = await getProviderByCloudProviderId("daytona");
  if (!computeProvider.execCommand) return null;
  const quotedDir = shellQuote(`${directory}/${SETUP_RELATIVE_DIR}`);
  const readCommand = [
    `D=${quotedDir}`,
    '[ -d "$D" ] || { echo GT_STATE=absent; exit 0; }',
    'echo "GT_STATE=$(cat "$D/state" 2>/dev/null)"',
    'echo "GT_EXIT=$(cat "$D/exit-code" 2>/dev/null)"',
    'echo "GT_STARTED=$(cat "$D/started-at" 2>/dev/null)"',
    'echo "GT_FINISHED=$(cat "$D/finished-at" 2>/dev/null)"',
    'echo "GT_LOG=$(tail -c 50000 "$D/setup.log" 2>/dev/null | base64 | tr -d "\\n")"',
  ].join("; ");

  const result = await withTimeout(
    computeProvider.execCommand(externalInstanceId, readCommand),
    "setup reconcile exec",
  );
  if (result.exitCode !== 0) return null;

  const values = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^GT_([A-Z]+)=(.*)$/);
    if (match?.[1] !== undefined) values.set(match[1], match[2] ?? "");
  }
  return toMarkers({
    state: values.get("STATE"),
    exitCode: values.get("EXIT"),
    startedAt: values.get("STARTED"),
    finishedAt: values.get("FINISHED"),
    log: values.get("LOG") ? Buffer.from(values.get("LOG") ?? "", "base64").toString("utf8") : null,
  });
}

async function readMarkersViaOpencode(input: {
  url: string;
  directory: string;
  password: string | null;
}): Promise<SetupMarkers | null> {
  const client = createWorkspaceOpencodeClient(input);
  const readFile = async (name: string): Promise<string | null> => {
    // Same relative form the direct SDK uses for its own setup status reads.
    const response = await client.file.read({
      query: { directory: input.directory, path: `${SETUP_RELATIVE_DIR}/${name}` },
    });
    if (response.error || !response.data || response.data.type !== "text") return null;
    return response.data.content;
  };

  const state = await withTimeout(readFile("state"), "setup reconcile read");
  if (state === null) return toMarkers({ state: null });
  const [exitCode, startedAt, finishedAt, log] = await withTimeout(
    Promise.all([
      readFile("exit-code"),
      readFile("started-at"),
      readFile("finished-at"),
      readFile("setup.log"),
    ]),
    "setup reconcile read",
  );
  return toMarkers({ state, exitCode, startedAt, finishedAt, log });
}

/**
 * Read the setup state files from inside the workspace and reconcile the DB
 * record when the workspace has progressed further than the last report, or
 * mark the setup failed when it has clearly stalled. Never throws; on any
 * failure the existing DB state is left untouched. Returns true only when a
 * poll actually ran (so callers know a re-read could observe something new).
 */
export async function reconcileWorkspaceSetupStatus(workspaceId: string): Promise<boolean> {
  try {
    if (!shouldPollNow(workspaceId)) return false;

    const record = await db.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
      with: { image: { with: { agentType: true } } },
    });
    if (!record || record.status !== "running" || !record.externalInstanceId) return false;

    const setup = await db.query.workspaceSetup.findFirst({
      where: eq(workspaceSetup.workspaceId, workspaceId),
    });
    if (!setup || setup.status === "succeeded" || setup.status === "failed") return false;

    const [provider] = await db
      .select()
      .from(cloudProvider)
      .where(eq(cloudProvider.id, record.cloudProviderId));
    const providerKey = provider?.providerKey?.toLowerCase() ?? null;
    const directory = resolveProjectDirectory(record.repositoryUrl, providerKey ?? undefined);

    let markers: SetupMarkers | null = null;
    if (providerKey === "daytona") {
      const config = (await getProviderConfigService().getProviderConfigForUse(
        "daytona",
      )) as DaytonaConfig | null;
      // Tier 3 sandboxes push their own reports; only pull when they can't.
      if (!config?.tier3NetworkAccess) {
        markers = await readMarkersViaExec(record.externalInstanceId, directory).catch(() => null);
      }
    }
    if (
      !markers &&
      record.subdomain &&
      record.serverOnly &&
      record.image?.agentType?.provisionerKey === "opencode"
    ) {
      markers = await readMarkersViaOpencode({
        url: getWorkspaceUrl(record.subdomain),
        directory,
        password: record.serverPassword ? decryptWorkspacePassword(record.serverPassword) : null,
      }).catch(() => null);
    }

    const now = new Date();
    if (
      markers &&
      (markers.state === "running" || markers.state === "succeeded" || markers.state === "failed")
    ) {
      // Mirror reportSetupStatus transition rules: never regress a terminal
      // state, and only move waiting -> running for intermediate updates.
      const state = markers.state;
      const allowedStatuses =
        state === "running" ? (["waiting"] as const) : (["waiting", "running"] as const);
      await db
        .update(workspaceSetup)
        .set({
          status: state,
          exitCode: state === "running" ? null : markers.exitCode,
          ...(markers.startedAt ? { startedAt: markers.startedAt } : {}),
          finishedAt: state === "running" ? null : markers.finishedAt,
          ...(markers.log !== null ? { log: markers.log } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaceSetup.workspaceId, workspaceId),
            inArray(workspaceSetup.status, [...allowedStatuses]),
          ),
        );
      return true;
    }

    const reason = stalledSetupReason({
      createdAt: setup.createdAt,
      now,
      state: markers ? markers.state : "unreadable",
    });
    if (reason && setup.status === "waiting") {
      await db
        .update(workspaceSetup)
        .set({ status: "failed", exitCode: null, finishedAt: now, log: reason, updatedAt: now })
        .where(
          and(eq(workspaceSetup.workspaceId, workspaceId), eq(workspaceSetup.status, "waiting")),
        );
    }
    return true;
  } catch (error) {
    console.warn(`Workspace setup reconcile failed for ${workspaceId}:`, error);
    return false;
  }
}
