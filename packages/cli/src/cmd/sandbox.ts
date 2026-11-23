import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  captureSource,
  createSandboxBackend,
  createSandboxClient,
  CREDENTIAL_REFERENCE,
  describeSandboxAccount,
  projectDir,
  resolveSandboxAccount,
  sourceLimitBytes,
  startPreviewProxy,
  type JobView,
  type SandboxAccount,
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

/**
 * Keys in the file are `{env:VAR}` or `{file:path}` references; a literal key is refused. With
 * no file, sandboxes go through the signed-in GitTerm account.
 */
async function loadSettings(): Promise<SandboxSettings> {
  const file = sandboxConfigPath();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const settings = JSON.parse(text) as SandboxSettings;
  const accounts = settings.accounts ?? { [settings.provider ?? "gitterm"]: settings };
  for (const [name, account] of Object.entries(accounts)) {
    const key = "apiKey" in account ? account.apiKey : undefined;
    if ((key !== undefined && !CREDENTIAL_REFERENCE.test(key.trim())) || "token" in account)
      throw new Error(
        `Sandbox account ${name} in ${file} contains a credential. Store it in an environment variable and use "apiKey": "{env:VAR}".`,
      );
  }
  return settings;
}

/** The checkout a command works on, as the path its records and setup snapshots use. */
const checkout = (dir?: string) => realpath(dir ?? process.cwd());

/** Variables from the settings' env files, read from the checkout. Later files win. */
async function envFileVars(settings: SandboxSettings, dir?: string) {
  const vars: Record<string, string> = Object.create(null);
  if (!settings.envFiles?.length) return vars;
  const root = await checkout(dir);
  for (const file of settings.envFiles) {
    const content = await readFile(path.resolve(root, file), "utf8").catch(() => {
      throw new Error(`Cannot read ${file} from the envFiles setting`);
    });
    Object.assign(vars, parseEnv(content));
  }
  return vars;
}

/**
 * Setup snapshots are on when the settings turn them on, the provider can save them, and the
 * account does not start every sandbox from its own snapshot.
 */
function snapshotsOn(settings: SandboxSettings, client: SandboxClient, account: SandboxAccount) {
  return (
    settings.snapshots === true &&
    client.snapshotEffect !== null &&
    !describeSandboxAccount(account).pinnedSnapshot
  );
}

async function clientFor(
  args: Common,
): Promise<{ client: SandboxClient; settings: SandboxSettings; account: SandboxAccount }> {
  const settings = await loadSettings();
  const account = await resolveSandboxAccount(settings, args.account);
  return {
    settings,
    account,
    client: createSandboxClient({
      backend: createSandboxBackend(account),
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

/** A job that ended without succeeding fails the CLI too, so scripts and CI see it. */
function exitWithJob(view: JobView): JobView {
  const { status, exitCode } = view.state;
  if (status !== "succeeded" && status !== "running") process.exitCode = exitCode || 1;
  return view;
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
      const account = await resolveSandboxAccount(await loadSettings(), args.account);
      return { ...describeSandboxAccount(account), configFile: sandboxConfigPath() };
    },
    (summary) => {
      console.log(`${chalk.bold(summary.name)}  ${summary.provider}`);
      console.log(
        `credential: ${summary.credentialSource}${summary.credentialPresent ? "" : chalk.red(" (missing)")}`,
      );
      console.log(`charged to: ${summary.chargedTo}`);
    },
  );
}

export async function runSandboxCreate(
  args: Common & {
    name?: string;
    purpose?: string;
    lifetime?: number;
    public?: boolean;
    snapshot?: string;
    session?: string;
    dir?: string;
    yes?: boolean;
  },
) {
  try {
    const { client, settings, account } = await clientFor(args);
    const summary = describeSandboxAccount(account);
    await approve(args, `Create a billable sandbox charged to ${summary.chargedTo}?`);
    // Where previews are always private there is nothing to approve.
    const publicPreviews =
      (args.public ?? settings.publicPreviews) === true &&
      client.capabilities.previews !== "private" &&
      client.capabilities.previews !== "none";
    if (args.public && publicPreviews && !settings.publicPreviews)
      await approve(args, "Make every preview of this sandbox public to anyone with its URL?");
    const project = await checkout(args.dir);
    // A sandbox starts from the newest setup snapshot saved for this checkout, unless told
    // which one, or `none`.
    const snapshots = snapshotsOn(settings, client, account)
      ? await client.setupSnapshots(project)
      : [];
    if (
      args.snapshot &&
      args.snapshot !== "none" &&
      !snapshots.some((item) => item.record.snapshotId === args.snapshot)
    )
      throw new Error(
        `No setup snapshot ${args.snapshot} for this checkout. See \`gitterm sandbox snapshot list\`, or pass --snapshot none.`,
      );
    const startFrom =
      args.snapshot === "none"
        ? null
        : (args.snapshot ??
          snapshots.find((item) => item.record.project === project)?.record.snapshotId ??
          null);
    await guarded(
      args,
      "Creating sandbox...",
      async () => ({
        ...(await client
          .create({
            name: args.name ?? "CLI sandbox",
            purpose: args.purpose ?? "cli",
            project,
            sessionId: args.session ?? null,
            lifetimeMinutes: args.lifetime,
            publicPreviews,
            ...(startFrom ? { snapshot: startFrom } : {}),
          })
          .catch((error: unknown) => {
            if (startFrom && error instanceof Error)
              error.message = `${error.message} It was to start from setup snapshot ${startFrom}: retry with --snapshot none, and delete the snapshot if it is gone or broken.`;
            throw error;
          })),
        startedFrom: startFrom,
        projectDir: projectDir(client.home),
      }),
      (record) =>
        success(
          `Sandbox ${chalk.bold(record.id)} (${record.account}) expires ${record.expiresAt ?? "-"}${record.startedFrom ? `, from setup snapshot ${record.startedFrom}` : ""}`,
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
          `${chalk.bold(record.id)}  ${record.state}  ${record.account}  "${record.name}"  age ${age ?? "?"} min  expires ${record.expiresAt ?? "-"}`,
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
    const captured = await captureSource(await checkout(args.dir), {
      exclude: settings.exclude,
      maxBytes: sourceLimitBytes(settings.maxSourceMiB),
    });
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
    background?: boolean;
    secretEnv?: string[];
    session?: string;
    dir?: string;
    yes?: boolean;
  },
) {
  try {
    const { client, settings } = await clientFor(args);
    const env = await envFileVars(settings, args.dir);
    const names = args.secretEnv ?? [];
    if (names.length) {
      await approve(
        args,
        `Pass ${names.join(", ")} from this machine to sandbox ${args.sandboxId}?`,
      );
      for (const name of names) {
        const value = process.env[name];
        if (value === undefined) throw new Error(`Local environment variable ${name} is not set`);
        env[name] = value;
      }
    }
    await guarded(
      args,
      "Running...",
      async () =>
        exitWithJob(
          await client.exec(refOf(client, args.sandboxId), {
            command: args.command,
            cwd: args.cwd,
            timeoutMinutes: args.timeout,
            env,
            sessionId: args.session,
            waitMs: args.background ? 0 : (args.wait ?? 60) * 1000,
          }),
        ),
      printJob,
    );
  } catch (error) {
    handleError(error, args.json);
  }
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
      return exitWithJob(
        args.wait && args.offset === undefined
          ? await client.wait(ref, args.jobId, args.wait * 1000)
          : await client.job(ref, args.jobId, { offset: args.offset, limit: args.limit }),
      );
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
  args: Common & {
    sandboxId: string;
    port: number;
    command?: string;
    cwd?: string;
    public?: boolean;
    serve?: boolean;
    dir?: string;
    yes?: boolean;
  },
) {
  try {
    const { client, settings } = await clientFor(args);
    if (args.public === true && !settings.publicPreviews)
      await approve(args, `Make port ${args.port} of this sandbox public to anyone with its URL?`);
    const spin = startSpinner("Waiting for the preview...", args.json);
    const preview = await client
      .preview(refOf(client, args.sandboxId), {
        port: args.port,
        public: args.public,
        command: args.command,
        cwd: args.cwd,
        env: args.command ? await envFileVars(settings, args.dir) : undefined,
      })
      .finally(() => spin?.stop());
    // Access headers stay in this process; JSON output omits them.
    const { access: _access, ...visible } = preview;
    if (args.json && !args.serve) return printJson(visible);
    console.log(
      `${preview.ready ? chalk.green("ready") : chalk.yellow("not answering")}  ${preview.url}  (${preview.public ? "public" : preview.viaGitterm ? "private: sign in to Gitterm" : "private"}, unauthenticated status ${preview.unauthenticatedStatus ?? "-"})`,
    );
    if (args.serve) {
      if (preview.public) return;
      const proxy = await startPreviewProxy(preview.access);
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
        `${artifact.remotePath} -> ${artifact.localPath}\nsha256 ${artifact.sha256} (${artifact.bytes} bytes, matches the sandbox file)`,
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

export async function runSandboxPause(args: Common & { sandboxId: string }) {
  await guarded(
    args,
    "Pausing...",
    async () => {
      const { client } = await clientFor(args);
      return client.pause(refOf(client, args.sandboxId));
    },
    (record) =>
      success(`Sandbox ${record.id} is ${record.state}. Its files are kept; using it resumes it.`),
  );
}

/** The account's setup snapshots for this checkout, or why it has none. */
export async function runSandboxSnapshotList(args: Common & { dir?: string }) {
  await guarded(
    args,
    "Reading setup snapshots...",
    async () => {
      const { client, settings, account } = await clientFor(args);
      if (!snapshotsOn(settings, client, account))
        return {
          enabled: false,
          effect: null,
          snapshots: [],
          reason:
            settings.snapshots !== true
              ? `Setup snapshots are off. Set "snapshots": true in ${sandboxConfigPath()} to use them.`
              : `${client.identity.provider} sandboxes on this account cannot be saved as setup snapshots, or the account starts every sandbox from its own snapshot.`,
        };
      return {
        enabled: true,
        // "pauses": saving pauses the sandbox briefly. "stops": the sandbox is gone after.
        effect: client.snapshotEffect,
        snapshots: await client.setupSnapshots(await checkout(args.dir)),
      };
    },
    (result) => {
      if (!result.enabled) return console.log(result.reason);
      if (!result.snapshots.length) return console.log("No setup snapshots for this checkout.");
      for (const { record, changed } of result.snapshots)
        console.log(
          `${chalk.bold(record.snapshotId)}  "${record.label}"  ${record.project ? "this checkout" : "any project"}  saved ${record.createdAt}${record.note ? `  ${record.note}` : ""}${changed.length ? chalk.yellow(`  out of date: ${changed.join(", ")}`) : ""}`,
        );
    },
  );
}

export async function runSandboxSnapshotSave(
  args: Common & {
    sandboxId: string;
    label: string;
    note?: string;
    anyProject?: boolean;
    replace?: string;
    dir?: string;
  },
) {
  await guarded(
    args,
    "Saving setup snapshot...",
    async () => {
      const { client, settings, account } = await clientFor(args);
      if (!snapshotsOn(settings, client, account))
        throw new Error(
          `Setup snapshots are not available: turn them on with "snapshots": true in ${sandboxConfigPath()}, on a provider that can save them.`,
        );
      const saved = await client.saveSetupSnapshot(refOf(client, args.sandboxId), {
        label: args.label,
        project: args.anyProject ? null : await checkout(args.dir),
        note: args.note,
        replace: args.replace,
      });
      return { ...saved, sandboxStopped: client.snapshotEffect === "stops" };
    },
    (saved) =>
      success(
        [
          `Saved setup snapshot ${saved.record.snapshotId} "${saved.record.label}"`,
          saved.replaced
            ? saved.leftover
              ? `It replaces ${saved.replaced}, which could not be deleted: delete it in the provider account.`
              : `Deleted ${saved.replaced}, which it replaces.`
            : "",
          saved.sandboxStopped
            ? `The provider stopped sandbox ${args.sandboxId} to save it: create a new one to continue.`
            : "",
        ]
          .filter(Boolean)
          .join(". "),
      ),
  );
}

export async function runSandboxSnapshotDelete(args: Common & { snapshotId: string }) {
  await guarded(
    args,
    "Deleting setup snapshot...",
    async () => (await clientFor(args)).client.deleteSetupSnapshot(args.snapshotId),
    (record) => success(`Deleted setup snapshot ${record.snapshotId} "${record.label}"`),
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
