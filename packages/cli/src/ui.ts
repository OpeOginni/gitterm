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

/** Asks a yes/no question; Enter takes the default (no, unless `yes`). */
export async function confirm(question: string, yes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} ${chalk.dim(yes ? "[Y/n]" : "[y/N]")} `))
      .trim()
      .toLowerCase();
    return answer ? answer === "y" || answer === "yes" : yes;
  } finally {
    rl.close();
  }
}

/** Asks for a line of text; Enter takes `fallback`. `hidden` keeps a pasted key off the screen. */
export async function ask(
  question: string,
  options: { fallback?: string; hidden?: boolean } = {},
): Promise<string> {
  const hint = options.fallback ? ` ${chalk.dim(`[${options.fallback}]`)}` : "";
  const answer = options.hidden
    ? await readHidden(`${question}${hint} `)
    : await (async () => {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          return await rl.question(`${question}${hint} `);
        } finally {
          rl.close();
        }
      })();
  return answer.trim() || options.fallback || "";
}

/** Reads a line in raw mode, showing nothing of what is typed or pasted. Ctrl-C exits. */
function readHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  return new Promise((resolve) => {
    let value = "";
    const done = (exit?: boolean) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (exit) process.exit(130);
      resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return done();
        if (char === "\u0003") return done(true);
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** A numbered menu; returns the index chosen. Enter takes the first. */
export async function choose(question: string, choices: string[]): Promise<number> {
  process.stderr.write(`${question}\n`);
  choices.forEach((choice, i) =>
    process.stderr.write(`  ${chalk.bold(String(i + 1))}. ${choice}\n`),
  );
  for (;;) {
    const answer = await ask(`Choose 1-${choices.length}:`, { fallback: "1" });
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && index >= 0 && index < choices.length) return index;
    process.stderr.write(chalk.yellow(`Type a number from 1 to ${choices.length}.\n`));
  }
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
