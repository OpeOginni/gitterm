import { createInterface } from "node:readline/promises";
import { GittermError } from "@gitterm/sdk";
import type { Workspace } from "@gitterm/sdk";
import chalk from "chalk";
import ora, { type Ora } from "ora";

/**
 * Spinner that stays on stderr so `--json` output on stdout remains parseable.
 * Returns null when not attached to a TTY (CI, pipes) or when emitting JSON.
 */
export function startSpinner(text: string, json?: boolean): Ora | null {
  if (json || !process.stderr.isTTY) return null;
  return ora({ text, stream: process.stderr }).start();
}

export function success(message: string) {
  console.log(`${chalk.green("✔")} ${message}`);
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function colorStatus(status: string): string {
  switch (status) {
    case "running":
      return chalk.green(status);
    case "pending":
      return chalk.yellow(status);
    case "stopped":
      return chalk.dim(status);
    case "terminated":
      return chalk.red(status);
    default:
      return status;
  }
}

function columnWidth(header: string, values: string[]) {
  return Math.max(header.length, ...values.map((value) => value.length));
}

function detailLine(label: string, value: string | null) {
  console.log(`${chalk.dim(`${label}:`.padEnd(12))} ${value ?? "-"}`);
}

export function printWorkspaceTable(workspaces: Workspace[]) {
  const rows = workspaces.map((workspace) => ({
    name: workspace.name ?? workspace.subdomain ?? workspace.id,
    id: workspace.id,
    status: workspace.status,
    agent: workspace.agentType?.name ?? "-",
    domain: workspace.domain,
  }));

  const widths = {
    name: columnWidth(
      "NAME",
      rows.map((row) => row.name),
    ),
    id: columnWidth(
      "ID",
      rows.map((row) => row.id),
    ),
    status: columnWidth(
      "STATUS",
      rows.map((row) => row.status),
    ),
    agent: columnWidth(
      "AGENT",
      rows.map((row) => row.agent),
    ),
  };

  console.log(
    chalk.bold(
      `${"NAME".padEnd(widths.name)}  ${"ID".padEnd(widths.id)}  ${"STATUS".padEnd(widths.status)}  ${"AGENT".padEnd(widths.agent)}  DOMAIN`,
    ),
  );
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(widths.name)}  ${chalk.dim(row.id.padEnd(widths.id))}  ${colorStatus(row.status.padEnd(widths.status))}  ${row.agent.padEnd(widths.agent)}  ${row.domain}`,
    );
  }
}

export function printWorkspaceDetails(workspace: Workspace) {
  detailLine("Name", workspace.name ?? workspace.subdomain);
  detailLine("ID", workspace.id);
  console.log(`${chalk.dim("Status:".padEnd(12))} ${colorStatus(workspace.status)}`);
  detailLine("Agent", workspace.agentType?.name ?? null);
  detailLine("Domain", workspace.domain);
  detailLine("Repository", workspace.repositoryUrl);
  detailLine("Branch", workspace.repositoryBranch);
  detailLine("Hosting", workspace.hostingType);
  detailLine("Persistent", workspace.persistent ? "yes" : "no");
  detailLine("Started", workspace.startedAt);
  detailLine("Stopped", workspace.stoppedAt);
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} ${chalk.dim("[y/N]")} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export function handleError(err: unknown, json?: boolean): never {
  const code = err instanceof GittermError ? err.code : "ERROR";
  const message = err instanceof Error ? err.message : String(err);

  if (json) {
    console.error(JSON.stringify({ error: { code, message } }, null, 2));
  } else {
    console.error(`${chalk.red("✖")} ${message}`);
  }
  process.exit(1);
}
