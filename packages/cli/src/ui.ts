import * as prompts from "@clack/prompts";
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

export function warn(message: string) {
  console.log(`${chalk.yellow("!")} ${message}`);
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
    case "paused":
      return chalk.yellow(status);
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
  detailLine("Paused", workspace.pausedAt);
}

/** Prompts go to stderr so `--json` output on stdout stays parseable. */
const promptIo = { output: process.stderr };

/** Ctrl-C or Escape in a prompt ends the CLI, as it did before. */
function answered<T>(value: T): Exclude<T, symbol> {
  if (prompts.isCancel(value)) {
    prompts.cancel("Cancelled.", promptIo);
    process.exit(130);
  }
  return value as Exclude<T, symbol>;
}

/** Asks a yes/no question; Enter takes the default (no, unless `yes`). */
export async function confirm(question: string, yes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  return answered(await prompts.confirm({ ...promptIo, message: question, initialValue: yes }));
}

/** Asks for a line of text; Enter takes `fallback`. `hidden` keeps a pasted key off the screen. */
export async function ask(
  question: string,
  options: { fallback?: string; hidden?: boolean } = {},
): Promise<string> {
  const answer = answered(
    options.hidden
      ? await prompts.password({ ...promptIo, message: question })
      : await prompts.text({
          ...promptIo,
          message: question,
          placeholder: options.fallback,
          defaultValue: options.fallback,
        }),
  );
  return answer?.trim() || options.fallback || "";
}

/** A menu moved through with the arrow keys; returns the index chosen. */
export async function choose(question: string, choices: string[]): Promise<number> {
  return answered(
    await prompts.select({
      ...promptIo,
      message: question,
      options: choices.map((label, value) => ({ value, label })),
    }),
  );
}

/** A checklist toggled with Space; returns the indexes picked. Starts with `picked` checked. */
export async function chooseMany(
  question: string,
  choices: string[],
  picked: number[] = [],
): Promise<number[]> {
  return answered(
    await prompts.multiselect({
      ...promptIo,
      message: question,
      options: choices.map((label, value) => ({ value, label })),
      initialValues: picked,
      required: false,
    }),
  );
}

export function handleError(err: unknown, json?: boolean): never {
  const own = (err as { code?: unknown } | null)?.code;
  const code = err instanceof GittermError ? err.code : typeof own === "string" ? own : "ERROR";
  const message = err instanceof Error ? err.message : String(err);
  // Fields a caller acts on, such as NEEDS_APPROVAL's question.
  const details = (err as { details?: Record<string, unknown> } | null)?.details;

  if (json) {
    console.error(JSON.stringify({ error: { code, message, ...details } }, null, 2));
  } else {
    console.error(`${chalk.red("✖")} ${message}`);
  }
  process.exit(1);
}
