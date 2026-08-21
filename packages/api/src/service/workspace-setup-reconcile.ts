import { and, db, eq, inArray } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspaceSetup } from "@gitterm/db/schema/workspace-setup";
import { getProviderByCloudProviderId } from "../providers";
import type { DaytonaConfig } from "../providers/daytona/types";
import { getProviderConfigService } from "./config/provider-config";
import { resolveProjectDirectory } from "./workspace-runtime";

/**
 * Pull-based fallback for providers whose sandboxes cannot call the gitterm
 * API (e.g. Daytona Tier 1/2 organizations, where egress is locked to an
 * allowlist that cannot be overridden per sandbox). The setup wrapper always
 * writes its state to files inside the workspace before attempting to report;
 * when those reports cannot arrive, we read the files over the provider's
 * control channel instead.
 *
 * Resource discipline: polling is demand-driven (runs only while someone is
 * actively asking for setup status), throttled per workspace, and skipped
 * entirely once the setup reaches a terminal state or the provider can push.
 */

const POLL_MIN_INTERVAL_MS = 10_000;
const EXEC_TIMEOUT_MS = 15_000;
const THROTTLE_ENTRY_TTL_MS = 10 * 60_000;

const lastPollAt = new Map<string, number>();

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

function parseMarkerOutput(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^GT_([A-Z]+)=(.*)$/);
    if (match?.[1] !== undefined) values.set(match[1], match[2] ?? "");
  }
  return values;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Read the setup state files from inside the workspace and reconcile the DB
 * record when the workspace has progressed further than the last report.
 * Never throws; on any failure the existing DB state is left untouched.
 * Returns true only when a poll actually ran (so callers know a re-read of
 * the setup record could observe something new).
 */
export async function reconcileWorkspaceSetupStatus(workspaceId: string): Promise<boolean> {
  try {
    if (!shouldPollNow(workspaceId)) return false;

    const record = await db.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
    });
    if (!record || record.status !== "running" || !record.externalInstanceId) return false;

    const [provider] = await db
      .select()
      .from(cloudProvider)
      .where(eq(cloudProvider.id, record.cloudProviderId));
    // Only Daytona currently blocks workspace -> API egress; other providers
    // report their own status and never need the pull fallback.
    if (provider?.providerKey?.toLowerCase() !== "daytona") return false;

    const config = (await getProviderConfigService().getProviderConfigForUse(
      "daytona",
    )) as DaytonaConfig | null;
    if (config?.tier3NetworkAccess) return false;

    const computeProvider = await getProviderByCloudProviderId("daytona");
    if (!computeProvider.execCommand) return false;

    const setupDir = `${resolveProjectDirectory(record.repositoryUrl, "daytona")}/.gitterm/setup`;
    const quotedDir = shellQuote(setupDir);
    const readCommand = [
      `D=${quotedDir}`,
      '[ -d "$D" ] || { echo GT_STATE=absent; exit 0; }',
      'echo "GT_STATE=$(cat "$D/state" 2>/dev/null)"',
      'echo "GT_EXIT=$(cat "$D/exit-code" 2>/dev/null)"',
      'echo "GT_STARTED=$(cat "$D/started-at" 2>/dev/null)"',
      'echo "GT_FINISHED=$(cat "$D/finished-at" 2>/dev/null)"',
      'echo "GT_LOG=$(tail -c 50000 "$D/setup.log" 2>/dev/null | base64 | tr -d "\\n")"',
    ].join("; ");

    const result = await Promise.race([
      computeProvider.execCommand(record.externalInstanceId, readCommand),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("setup reconcile exec timed out")), EXEC_TIMEOUT_MS),
      ),
    ]);
    if (result.exitCode !== 0) return true;

    const values = parseMarkerOutput(result.stdout);
    const state = values.get("STATE")?.trim();
    if (state !== "running" && state !== "succeeded" && state !== "failed") return true;

    const log = values.get("LOG")
      ? Buffer.from(values.get("LOG") ?? "", "base64")
          .toString("utf8")
          .replaceAll("\0", "")
          .slice(-50_000)
      : null;
    const exitCodeRaw = Number.parseInt(values.get("EXIT") ?? "", 10);
    const exitCode = Number.isInteger(exitCodeRaw) ? exitCodeRaw : null;
    const startedAt = parseIsoDate(values.get("STARTED")?.trim());
    const finishedAt = parseIsoDate(values.get("FINISHED")?.trim());

    // Mirror reportSetupStatus transition rules: never regress a terminal
    // state, and only move waiting -> running for intermediate updates.
    const allowedStatuses =
      state === "running" ? (["waiting"] as const) : (["waiting", "running"] as const);
    await db
      .update(workspaceSetup)
      .set({
        status: state,
        exitCode: state === "running" ? null : exitCode,
        ...(startedAt ? { startedAt } : {}),
        finishedAt: state === "running" ? null : finishedAt,
        ...(log !== null ? { log } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceSetup.workspaceId, workspaceId),
          inArray(workspaceSetup.status, [...allowedStatuses]),
        ),
      );
    return true;
  } catch (error) {
    console.warn(`Workspace setup reconcile failed for ${workspaceId}:`, error);
    return false;
  }
}
