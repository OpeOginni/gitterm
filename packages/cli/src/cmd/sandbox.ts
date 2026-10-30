import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  captureSource,
  createSandboxBackend,
  createSandboxClient,
  describeSandboxAccount,
  startPreviewProxy,
  type JobView,
  type SandboxClient,
  type SandboxSettings,
} from "@gitterm/sdk/sandbox";
import chalk from "chalk";
import { confirm, handleError, printJson, startSpinner, success } from "../ui.js";

type Common = { json?: boolean; account?: string };

export function sandboxConfigPath(): string {
  return (
    process.env.GITTERM_SANDBOX_CONFIG ?? path.join(homedir(), ".config", "gitterm", "sandbox.json")
  );
}

/** The file holds account names and env var names only; a literal key is refused. */
async function loadSettings(): Promise<SandboxSettings> {
  const file = sandboxConfigPath();
  const text = await readFile(file, "utf8").catch(() => {
    throw new Error(
      `No sandbox settings at ${file}. Create it, for example:\n${JSON.stringify(
        {
          account: "e2b",
          accounts: {
            e2b: { mode: "direct", provider: "e2b", apiKeyEnv: "E2B_API_KEY" },
            gitterm: { mode: "managed" },
          },
        },
        null,
        2,
      )}`,
    );
  });
  const settings = JSON.parse(text) as SandboxSettings;
  for (const [name, account] of Object.entries(settings.accounts ?? {})) {
    if ("apiKey" in account || "token" in account)
      throw new Error(
        `Sandbox account ${name} in ${file} contains a credential. Store it in an environment variable and reference it with apiKeyEnv.`,
      );
  }
  return settings;
}

async function clientFor(
  args: Common,
): Promise<{ client: SandboxClient; settings: SandboxSettings }> {
  const settings = await loadSettings();
  if (args.account) settings.account = args.account;
  return {
    settings,
    client: createSandboxClient({
      backend: createSandboxBackend(settings),
      limits: settings.limits,
    }),
  };
}

const refOf = (client: SandboxClient, id: string) => ({ ...client.identity, id });

async function guarded<T>(
  args: Common,
  text: string,
  action: () => Promise<T>,
  print: (value: T) => void,
) {
  const spin = startSpinner(text, args.json);
  try {
    const value = await action();
    spin?.stop();
    if (args.json) printJson(value);
    else print(value);
  } catch (error) {
    spin?.stop();
    handleError(error, args.json);
  }
}

async function approve(args: Common & { yes?: boolean }, question: string) {
  if (args.yes) return;
  if (args.json || !(await confirm(question))) {
    throw new Error("Not approved. Pass --yes to approve non-interactively.");
  }
}

function printJob(view: JobView) {
  const { job, state, log } = view;
  console.log(
    `${chalk.bold(job.id)} ${state.status}${state.exitCode === null ? "" : ` (exit ${state.exitCode})`}`,
  );
  console.log(
    chalk.dim(
      `snapshot ${job.snapshotId ?? "none"}  started ${state.startedAt ?? "-"}  finished ${state.finishedAt ?? "-"}  alive ${state.processAlive}`,
    ),
  );
  console.log(chalk.dim(`output bytes ${log.offset}-${log.nextOffset} of ${log.totalBytes}`));
  process.stdout.write(log.text.endsWith("\n") || !log.text ? log.text : `${log.text}\n`);
}

export async function runSandboxAccount(args: Common) {
  await guarded(
    args,
    "Reading settings...",
    async () => {
      const settings = await loadSettings();
      return { ...describeSandboxAccount(settings, args.account), configFile: sandboxConfigPath() };
    },
    (summary) => {
      console.log(`${chalk.bold(summary.name)}  ${summary.mode} ${summary.provider}`);
      console.log(
        `credential: ${summary.credentialSource}${summary.credentialPresent ? "" : chalk.red(" (missing)")}`,
      );
      console.log(`charged to: ${summary.chargedTo}`);
    },
  );
}

export async function runSandboxCreate(
  args: Common & { name?: string; lifetime?: number; public?: boolean; yes?: boolean },
) {
  try {
    const { client, settings } = await clientFor(args);
    const summary = describeSandboxAccount(settings);
    await approve(args, `Create a billable sandbox charged to ${summary.chargedTo}?`);
    if (args.public)
      await approve(args, "Make every preview of this sandbox public to anyone with its URL?");
    await guarded(
      args,
      "Creating sandbox...",
      () =>
        client.create({
          name: args.name ?? "CLI sandbox",
          purpose: "cli",
          project: process.cwd(),
          lifetimeMinutes: args.lifetime,
          publicPreviews: args.public,
        }),
      (record) =>
        success(
          `Sandbox ${chalk.bold(record.id)} (${record.mode}/${record.account}) expires ${record.expiresAt ?? "-"}`,
        ),
    );
  } catch (error) {
    handleError(error, args.json);
  }
}

export async function runSandboxList(args: Common) {
  await guarded(
    args,
    "Listing sandboxes...",
    async () => (await clientFor(args)).client.list(),
    (records) => {
      const live = records.filter((record) => record.state !== "terminated");
      if (!live.length) return console.log("No live sandboxes.");
      for (const record of live) {
        const age = record.createdAt
          ? Math.round((Date.now() - Date.parse(record.createdAt)) / 60_000)
          : null;
        console.log(
          `${chalk.bold(record.id)}  ${record.state}  ${record.mode}/${record.account}  "${record.name}"  age ${age ?? "?"} min  expires ${record.expiresAt ?? "-"}`,
        );
      }
    },
  );
}

export async function runSandboxSync(
  args: Common & { sandboxId: string; dir?: string; yes?: boolean },
) {
  try {
    const { client, settings } = await clientFor(args);
    const captured = await captureSource(args.dir ?? process.cwd(), { exclude: settings.exclude });
    const { snapshot } = captured;
    if (!args.json) {
      console.error(
        `${snapshot.files.length} files (${snapshot.bytes} bytes) from ${snapshot.root}`,
      );
      console.error(
        `modified ${snapshot.modified.length}, untracked ${snapshot.untracked.length}, deleted ${snapshot.deleted.length}`,
      );
      for (const item of snapshot.excluded)
        console.error(chalk.dim(`excluded ${item.path} (${item.reason})`));
    }
    await approve(args, `Upload this checkout to sandbox ${args.sandboxId}?`);
    await guarded(
      args,
      "Uploading...",
      () => client.sync(refOf(client, args.sandboxId), captured),
      (result) =>
        success(
          `Snapshot ${result.snapshot.id} (sha256 ${result.snapshot.digest}) verified in the sandbox`,
        ),
    );
  } catch (error) {
    handleError(error, args.json);
  }
}

export async function runSandboxExec(
  args: Common & {
    sandboxId: string;
    command: string;
    cwd?: string;
    timeout?: number;
    wait?: number;
  },
) {
  await guarded(
    args,
    "Running...",
    async () => {
      const { client } = await clientFor(args);
      return client.exec(refOf(client, args.sandboxId), {
        command: args.command,
        cwd: args.cwd,
        timeoutMinutes: args.timeout,
        waitMs: (args.wait ?? 60) * 1000,
      });
    },
    printJob,
  );
}

export async function runSandboxJob(
  args: Common & {
    sandboxId: string;
    jobId: string;
    offset?: number;
    limit?: number;
    wait?: number;
  },
) {
  await guarded(
    args,
    "Reading job...",
    async () => {
      const { client } = await clientFor(args);
      const ref = refOf(client, args.sandboxId);
      return args.wait && args.offset === undefined
        ? client.wait(ref, args.jobId, args.wait * 1000)
        : client.job(ref, args.jobId, { offset: args.offset, limit: args.limit });
    },
    printJob,
  );
}

export async function runSandboxCancel(args: Common & { sandboxId: string; jobId: string }) {
  await guarded(
    args,
    "Cancelling...",
    async () => {
      const { client } = await clientFor(args);
      return client.cancel(refOf(client, args.sandboxId), args.jobId);
    },
    printJob,
  );
}

export async function runSandboxPreview(
  args: Common & { sandboxId: string; port: number; command?: string; serve?: boolean },
) {
  try {
    const { client } = await clientFor(args);
    const spin = startSpinner("Waiting for the preview...", args.json);
    const preview = await client
      .preview(refOf(client, args.sandboxId), { port: args.port, command: args.command })
      .finally(() => spin?.stop());
    // Access headers stay in this process; JSON output omits them.
    const { headers: _headers, ...visible } = preview;
    if (args.json && !args.serve) return printJson(visible);
    console.log(
      `${preview.ready ? chalk.green("ready") : chalk.yellow("not answering")}  ${preview.url}  (${preview.public ? "public" : "private"}, unauthenticated status ${preview.unauthenticatedStatus ?? "-"})`,
    );
    if (args.serve) {
      if (preview.public) return;
      const proxy = await startPreviewProxy(preview);
      console.log(`Local URL (until you press Ctrl-C): ${proxy.url}`);
      await new Promise<void>((resolve) => process.once("SIGINT", resolve));
      await proxy.close();
    }
  } catch (error) {
    handleError(error, args.json);
  }
}

export async function runSandboxArtifact(
  args: Common & { sandboxId: string; jobId: string; path: string },
) {
  await guarded(
    args,
    "Downloading...",
    async () => {
      const { client } = await clientFor(args);
      return client.fetchArtifact(refOf(client, args.sandboxId), args.path, { jobId: args.jobId });
    },
    (artifact) =>
      success(
        `${artifact.remotePath} -> ${artifact.localPath}\nsha256 ${artifact.sha256} (${artifact.bytes} bytes, verified ${artifact.verified})`,
      ),
  );
}

export async function runSandboxApply(
  args: Common & { sandboxId: string; artifact: string; target: string; yes?: boolean },
) {
  try {
    const { client } = await clientFor(args);
    // The baseline is the snapshot the producing job ran on, not the latest sync.
    await guarded(
      args,
      "Applying...",
      () =>
        client.applyArtifact(refOf(client, args.sandboxId), {
          localPath: args.artifact,
          target: args.target,
          beforeWrite: (plan) =>
            approve(args, `Write ${plan.target} in ${plan.root} (from job ${plan.jobId})?`),
        }),
      (applied) => success(`Applied ${applied.path} from job ${applied.jobId}`),
    );
  } catch (error) {
    handleError(error, args.json);
  }
}

export async function runSandboxResume(args: Common & { sandboxId: string }) {
  await guarded(
    args,
    "Resuming...",
    async () => {
      const { client } = await clientFor(args);
      const record = await client.resume(refOf(client, args.sandboxId));
      return { ...record, filesKept: client.capabilities.pause === "stateful" };
    },
    (record) =>
      success(
        `Sandbox ${record.id} is ${record.state}${record.filesKept ? "" : ". This provider discarded files and processes while paused: sync again before running commands."}`,
      ),
  );
}

export async function runSandboxDestroy(args: Common & { sandboxId: string }) {
  await guarded(
    args,
    "Destroying...",
    async () => {
      const { client } = await clientFor(args);
      return client.destroy(refOf(client, args.sandboxId));
    },
    (record) => success(`Sandbox ${record.id} is ${record.state} (confirmed with the provider)`),
  );
}
