import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  approveProject,
  assertProjectAllows,
  createGittermClient,
  DEFAULT_GITTERM_SERVER_URL,
  loadConfig,
  projectSettings,
} from "@gitterm/sdk";
import {
  captureSource,
  CLI_LOGIN_PROVIDERS,
  cliLogin,
  createSandboxBackend,
  createSandboxClient,
  describeSandboxAccount,
  isOwnKey,
  loadSandboxSettingsFile,
  sandboxSettingsPath,
  projectDir,
  resolveSandboxAccount,
  sourceLimitBytes,
  startPreviewProxy,
  type JobView,
  type SandboxAccount,
  type SandboxAccountConfig,
  type SandboxClient,
  type SandboxSettings,
} from "@gitterm/sdk/sandbox";
import chalk from "chalk";
import {
  ask,
  choose,
  confirm,
  handleError,
  printJson,
  startSpinner,
  success,
  warn,
} from "../ui.js";
import { signIn } from "./auth.js";
import { projectRoot } from "./project.js";

type Common = { json?: boolean; account?: string };

/** With no settings file, sandboxes go through the signed-in GitTerm account. */
const loadSettings = async (): Promise<SandboxSettings> => loadSandboxSettingsFile() ?? {};

/** Refuses when sandboxes are turned off for the project at `dir` on this machine. */
const allowed = (dir?: string) => assertProjectAllows(dir ?? process.cwd(), "sandbox");

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

/**
 * Asks before a step that costs money or shares the checkout. Routine steps (create, sync,
 * apply) don't ask in a project the user approved with "Always in this project"; secrets and
 * public previews ask every time. `--yes` approves once; `--always` also approves the project.
 * Without a terminal, a step that needs asking fails with NEEDS_APPROVAL, carrying the question,
 * so an agent or plugin asks the user. A command asks at most one question, so `--yes` answers
 * only what was asked.
 */
async function approve(
  args: Common & { yes?: boolean; always?: boolean; dir?: string },
  question: string,
  routine = true,
) {
  const root = await projectRoot(args.dir);
  if (routine && args.always) return void approveProject(root);
  if (args.yes || (routine && projectSettings(root).approved)) return;
  if (args.json || !process.stdin.isTTY)
    throw Object.assign(
      new Error(
        `Needs the user's approval: ${question} Ask them, then run again with --yes${routine ? ", or with --always to stop asking in this project" : ""}.`,
      ),
      { code: "NEEDS_APPROVAL", details: { question, always: routine } },
    );
  const answer = routine
    ? await choose(question, ["Yes", "Always in this project", "No"])
    : (await confirm(question))
      ? 0
      : 2;
  if (answer === 1) approveProject(root);
  if (answer === 2) throw new Error("Not approved.");
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
      return { ...describeSandboxAccount(account), configFile: sandboxSettingsPath() };
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
    always?: boolean;
  },
) {
  try {
    allowed(args.dir);
    const { client, settings, account } = await clientFor(args);
    const summary = describeSandboxAccount(account);
    // Where previews are always private there is nothing to approve.
    const publicPreviews =
      (args.public ?? settings.publicPreviews) === true &&
      client.capabilities.previews !== "private" &&
      client.capabilities.previews !== "none";
    // Public previews ask every time, so that question replaces the routine one.
    const askPublic = args.public === true && publicPreviews && !settings.publicPreviews;
    await approve(
      args,
      `Create a billable sandbox charged to ${summary.chargedTo}${askPublic ? ", with every preview public to anyone with its URL" : ""}?`,
      !askPublic,
    );
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
  args: Common & { sandboxId: string; dir?: string; yes?: boolean; always?: boolean },
) {
  try {
    allowed(args.dir);
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
    allowed(args.dir);
    const { client, settings } = await clientFor(args);
    const env = await envFileVars(settings, args.dir);
    const names = args.secretEnv ?? [];
    if (names.length) {
      await approve(
        args,
        `Pass ${names.join(", ")} from this machine to sandbox ${args.sandboxId}?`,
        false,
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
    dir?: string;
  },
) {
  await guarded(
    args,
    "Reading job...",
    async () => {
      // Reading a job resumes a paused sandbox.
      allowed(args.dir);
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

export async function runSandboxCancel(
  args: Common & { sandboxId: string; jobId: string; dir?: string },
) {
  await guarded(
    args,
    "Cancelling...",
    async () => {
      // Cancelling resumes a paused sandbox; destroying it needs no resume.
      allowed(args.dir);
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
    allowed(args.dir);
    const { client, settings } = await clientFor(args);
    if (args.public === true && !settings.publicPreviews)
      await approve(
        args,
        `Make port ${args.port} of this sandbox public to anyone with its URL?`,
        false,
      );
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
  args: Common & { sandboxId: string; jobId: string; path: string; dir?: string },
) {
  await guarded(
    args,
    "Downloading...",
    async () => {
      allowed(args.dir);
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
  args: Common & {
    sandboxId: string;
    artifact: string;
    target: string;
    yes?: boolean;
    always?: boolean;
  },
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
          // The checkout written to is the one that decides.
          beforeWrite: async (plan) => {
            allowed(plan.root);
            await approve(
              { ...args, dir: plan.root },
              `Write ${plan.target} in ${plan.root} (from job ${plan.jobId})?`,
            );
          },
        }),
      (applied) => success(`Applied ${applied.path} from job ${applied.jobId}`),
    );
  } catch (error) {
    handleError(error, args.json);
  }
}

export async function runSandboxResume(args: Common & { sandboxId: string; dir?: string }) {
  await guarded(
    args,
    "Resuming...",
    async () => {
      allowed(args.dir);
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
              ? `Setup snapshots are off. Set "snapshots": true in ${sandboxSettingsPath()} to use them.`
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
      allowed(args.dir);
      const { client, settings, account } = await clientFor(args);
      if (!snapshotsOn(settings, client, account))
        throw new Error(
          `Setup snapshots are not available: turn them on with "snapshots": true in ${sandboxSettingsPath()}, on a provider that can save them.`,
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

// ---------- gitterm sandbox setup ----------

/** Providers a sandbox account can use with your own key. Railway is deprecated. */
const DIRECT = [
  { provider: "e2b", name: "E2B", env: "E2B_API_KEY" },
  { provider: "daytona", name: "Daytona", env: "DAYTONA_API_KEY" },
  { provider: "vercel", name: "Vercel", env: "VERCEL_TOKEN" },
  { provider: "boat", name: "Boat", env: "BOAT_API_KEY" },
  { provider: "exedev", name: "exe.dev", env: "EXEDEV_API_KEY" },
] as const;

/** Account fields; everything else in the settings applies to every account. */
const OPTION_KEYS = [
  "limits",
  "exclude",
  "maxSourceMiB",
  "publicPreviews",
  "snapshots",
  "envFiles",
];

/**
 * The settings file's contents with `account` as the selected account, keeping the settings
 * and any other accounts already there. `account` holds the fields setup asked about (an
 * undefined one is cleared); the rest of an account of the same kind under `name` stays.
 */
function withAccount(name: string, account: Partial<Record<string, unknown>>) {
  const current = (loadSandboxSettingsFile() ?? {}) as Record<string, unknown>;
  const options = Object.fromEntries(
    Object.entries(current).filter(([key]) => OPTION_KEYS.includes(key)),
  );
  const accounts = { ...(current.accounts as Record<string, SandboxAccountConfig> | undefined) };
  if (!current.accounts) {
    // One account written inline: keep it, under its name, next to the new one.
    const inline = Object.fromEntries(
      Object.entries(current).filter(([key]) => !OPTION_KEYS.includes(key) && key !== "account"),
    ) as SandboxAccountConfig;
    if (Object.keys(inline).length) accounts[inline.provider ?? "gitterm"] = inline;
  }
  const changed = Object.fromEntries(
    Object.entries(account).filter(([, value]) => value !== undefined),
  ) as SandboxAccountConfig;
  const before = accounts[name];
  accounts[name] = (
    before && isOwnKey(before) === isOwnKey(changed)
      ? Object.fromEntries(
          Object.entries({ ...before, ...account }).filter(([, value]) => value !== undefined),
        )
      : changed
  ) as SandboxAccountConfig;
  return { ...options, account: name, accounts };
}

/**
 * Checks the account with GitTerm or the provider, then saves it (and a pasted `key`) as the
 * selected account. A failed check writes nothing, so the account that worked before stays.
 */
async function saveAccount(name: string, account: Record<string, unknown>, key?: string) {
  const settings = withAccount(name, key ? { ...account, apiKey: key } : account);
  const resolved = await resolveSandboxAccount(settings, name);
  const summary = describeSandboxAccount(resolved);
  if (summary.credentialPresent) {
    const spin = startSpinner("Checking the account...");
    await createSandboxBackend(resolved)
      .check()
      .finally(() => spin?.stop());
  }
  if (key)
    settings.accounts[name] = {
      ...settings.accounts[name],
      apiKey: `{file:${await saveKey(name, key)}}`,
    } as SandboxAccountConfig;
  const file = sandboxSettingsPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  const provider =
    DIRECT.find((item) => item.provider === summary.provider)?.name ?? summary.provider;
  success(`Sandboxes run on ${provider}, charged to ${summary.chargedTo}. Saved in ${file}.`);
  if (!summary.credentialPresent)
    warn(`The key is missing (${summary.credentialSource}). Sandboxes fail until it is there.`);
  console.log("Restart your agents so they use it.");
}

/** Saves a pasted key in a file only the user can read; the settings point at it. */
async function saveKey(name: string, key: string): Promise<string> {
  const dir = path.join(path.dirname(sandboxSettingsPath()), "keys");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  await writeFile(file, `${key}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

/** Sandboxes on the user's GitTerm plan: signs in if needed, then the provider and size. */
async function gittermAccount(): Promise<{ name: string; account: Record<string, unknown> }> {
  // With no login at all, creating the client throws: that is "not signed in" too.
  if (
    !(await Promise.resolve()
      .then(() => createGittermClient().auth.status())
      .then(
        () => true,
        () => false,
      ))
  ) {
    if (
      !(await confirm(
        "Sign in to Gitterm now? New here? Create a free account on the same page.",
        true,
      ))
    )
      throw new Error(
        "Sandboxes on a Gitterm plan need a Gitterm login. Run `gitterm login`, then try again.",
      );
    await signIn(
      process.env.GITTERM_SERVER_URL ??
        (await loadConfig())?.serverUrl ??
        DEFAULT_GITTERM_SERVER_URL,
    );
  }
  const client = createGittermClient();
  const offered = await client.sandboxes.providers();
  if (!offered.providers.length)
    throw new Error("This Gitterm server offers no sandboxes to your account.");
  const providers = [...offered.providers].sort(
    (a, b) => Number(b === offered.default) - Number(a === offered.default),
  );
  let provider: string | undefined;
  if (providers.length > 1) {
    const picked =
      providers[
        await choose(
          "Which provider should run them?",
          providers.map((key) => (key === offered.default ? `${key} (the default)` : key)),
        )
      ]!;
    if (picked !== offered.default) provider = picked;
  }
  const size = await ask("Machine size, such as small or medium (Enter for your plan's default):");
  return {
    name: "gitterm",
    // What was asked; undefined clears it (the server's default provider, the plan's size).
    account: {
      // The server marks it a GitTerm account: { provider: "e2b" } alone is E2B's CLI login.
      serverUrl: client.serverUrl,
      provider,
      size: size || undefined,
    },
  };
}

/** Sandboxes on the user's own provider account: its CLI login, a pasted key, or a variable. */
async function directAccount(): Promise<{
  name: string;
  account: Record<string, unknown>;
  key?: string;
}> {
  const { provider, name, env } =
    DIRECT[
      await choose(
        "Which provider?",
        DIRECT.map((item) => item.name),
      )
    ]!;
  // The credential is always asked about: none set means the provider CLI's login.
  const account: Record<string, unknown> = { provider, apiKey: undefined, apiKeyEnv: undefined };
  let key: string | undefined;
  const login = (CLI_LOGIN_PROVIDERS as readonly string[]).includes(provider)
    ? await cliLogin(provider)
    : undefined;
  // Your provider CLI's login, when found, comes first: Enter takes it.
  const how =
    (await choose(`How should Gitterm get your ${name} key?`, [
      ...(login ? [`Use your ${login.source}`] : []),
      "Paste it now (saved in a file only you can read)",
      `From an environment variable, such as ${env}`,
    ])) - (login ? 1 : 0);
  if (how === 0) {
    key = await ask(`${name} API key:`, { hidden: true });
    if (!key) throw new Error("No key was given.");
  } else if (how === 1) {
    const variable = await ask("Environment variable:", { fallback: env });
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
      throw new Error(`${variable} is not an environment variable name.`);
    account.apiKey = `{env:${variable}}`;
    if (!process.env[variable])
      warn(`${variable} is not set in this shell. Set it where your agents start.`);
  }
  if (provider === "vercel") {
    account.teamId = await ask("Vercel team id (team_…):");
    account.projectId = await ask("Vercel project id (prj_…):");
    if (!account.teamId || !account.projectId)
      throw new Error("Vercel sandboxes need a team id and a project id.");
  }
  if (provider === "exedev") {
    if (
      !(await confirm(
        "exe.dev never deletes a sandbox by itself: one left behind by a crash keeps running, and billing, until you destroy it. Accept that?",
      ))
    )
      throw new Error("exe.dev sandboxes need that accepted.");
    account.allowUnboundedLifetime = true;
  }
  return { name: provider, account, key };
}

/** Sets up the user's own provider account. Used by `gitterm setup` too. */
export async function setUpOwnProvider() {
  const { name, account, key } = await directAccount();
  await saveAccount(name, account, key);
}

/** Asks where sandboxes run and writes the settings, so nobody edits the file by hand. */
export async function runSandboxSetup() {
  try {
    if (!process.stdin.isTTY)
      throw new Error(
        `Run \`gitterm sandbox setup\` in a terminal, or edit ${sandboxSettingsPath()}.`,
      );
    const where = await choose("Where should sandboxes run?", [
      "On your Gitterm plan: no provider account needed",
      `On your own provider account (${DIRECT.map((item) => item.name).join(", ")}), billed by them`,
    ]);
    const { name, account, key } =
      where === 0 ? { ...(await gittermAccount()), key: undefined } : await directAccount();
    await saveAccount(name, account, key);
  } catch (error) {
    handleError(error);
  }
}
