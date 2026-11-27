import { createGittermClient } from "@gitterm/sdk";
import type { WorkspaceListOptions } from "@gitterm/sdk";
import chalk from "chalk";
import type { Ora } from "ora";
import {
  choose,
  confirm,
  handleError,
  printJson,
  printWorkspaceDetails,
  printWorkspaceTable,
  startSpinner,
  success,
} from "../ui.js";

type JsonArgs = { json?: boolean };
type WorkspaceArgs = JsonArgs & { workspaceId?: string };

async function workspaceFor(args: WorkspaceArgs, status?: string): Promise<string> {
  if (args.workspaceId) return args.workspaceId;
  if (args.json || !process.stdin.isTTY)
    throw new Error("Name a workspace id: `gitterm workspace list` shows them.");
  const { workspaces } = await createGittermClient().workspaces.list({ status: "active" });
  const offered = status
    ? workspaces.filter((workspace) => workspace.status === status)
    : workspaces;
  if (!offered.length) throw new Error(`You have no ${status ?? "active"} workspaces.`);
  const picked = await choose(
    "Which workspace?",
    offered.map(
      (workspace) =>
        `${workspace.name ?? workspace.subdomain ?? workspace.id}  ${chalk.dim(`${workspace.status} · ${workspace.agentType?.name ?? "-"} · ${workspace.id}`)}`,
    ),
  );
  return offered[picked]!.id;
}

export async function runWorkspaceList(args: JsonArgs & { status?: string; limit?: number }) {
  const spin = startSpinner("Fetching workspaces...", args.json);
  try {
    const client = createGittermClient();
    const result = await client.workspaces.list({
      status: args.status as WorkspaceListOptions["status"],
      limit: args.limit,
    });
    spin?.stop();

    if (args.json) {
      printJson(result);
      return;
    }

    if (result.workspaces.length === 0) {
      console.log("No workspaces found.");
      return;
    }

    printWorkspaceTable(result.workspaces);
    if (result.pagination.hasMore) {
      console.log(
        chalk.dim(`\nShowing ${result.workspaces.length} of ${result.pagination.total}.`),
      );
    }
  } catch (err) {
    spin?.stop();
    handleError(err, args.json);
  }
}

export async function runWorkspaceGet(args: WorkspaceArgs) {
  let spin: Ora | null = null;
  try {
    const workspaceId = await workspaceFor(args);
    spin = startSpinner("Fetching workspace...", args.json);
    const workspace = await createGittermClient().workspaces.get(workspaceId);
    spin?.stop();

    if (args.json) {
      printJson(workspace);
      return;
    }

    printWorkspaceDetails(workspace);
  } catch (err) {
    spin?.stop();
    handleError(err, args.json);
  }
}

export async function runWorkspacePause(args: WorkspaceArgs) {
  let spin: Ora | null = null;
  try {
    const workspaceId = await workspaceFor(args, "running");
    spin = startSpinner("Pausing workspace...", args.json);
    const result = await createGittermClient().workspaces.pause(workspaceId);
    spin?.stop();

    if (args.json) {
      printJson(result);
      return;
    }

    success(`Workspace paused (ran for ${result.durationMinutes} min).`);
  } catch (err) {
    spin?.stop();
    handleError(err, args.json);
  }
}

/** @deprecated use runWorkspacePause */
export const runWorkspaceStop = runWorkspacePause;

export async function runWorkspaceRestart(args: WorkspaceArgs) {
  let spin: Ora | null = null;
  try {
    const workspaceId = await workspaceFor(args, "paused");
    spin = startSpinner("Restarting workspace...", args.json);
    const result = await createGittermClient().workspaces.restart(workspaceId);
    spin?.stop();

    if (args.json) {
      printJson(result);
      return;
    }

    success(result.status === "running" ? "Workspace restarted." : "Workspace restarting...");
  } catch (err) {
    spin?.stop();
    handleError(err, args.json);
  }
}

export async function runWorkspaceTerminate(args: WorkspaceArgs & { yes?: boolean }) {
  try {
    const workspaceId = await workspaceFor(args);
    if (!args.yes && !args.json) {
      const confirmed = await confirm(
        `Terminate workspace ${chalk.bold(workspaceId)}? This cannot be undone.`,
      );
      if (!confirmed) {
        console.error("Aborted. Pass --yes to skip this prompt.");
        process.exit(1);
      }
    } else if (!args.yes && args.json) {
      // JSON mode is for scripts; require the explicit flag instead of prompting.
      handleError(new Error("Refusing to terminate without --yes in --json mode."), args.json);
    }

    const spin = startSpinner("Terminating workspace...", args.json);
    try {
      const result = await createGittermClient().workspaces.terminate(workspaceId);
      spin?.stop();

      if (args.json) {
        printJson(result);
        return;
      }

      success(
        result.cleanupInBackground
          ? "Workspace terminated. Cloud resources are being cleaned up in the background."
          : "Workspace terminated.",
      );
    } catch (err) {
      spin?.stop();
      throw err;
    }
  } catch (err) {
    handleError(err, args.json);
  }
}
