#!/usr/bin/env node
import { DEFAULT_GITTERM_SERVER_URL, getWorkspaceEnvironment } from "@gitterm/sdk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import pkg from "../package.json" with { type: "json" };
import { runAuthStatus, runLogin, runLogout } from "./cmd/auth.js";
import {
  runWorkspaceGet,
  runWorkspaceList,
  runWorkspacePause,
  runWorkspaceRestart,
  runWorkspaceTerminate,
} from "./cmd/workspace.js";
import { handleError } from "./ui.js";
import {
  runSandboxAccount,
  runSandboxApply,
  runSandboxArtifact,
  runSandboxCancel,
  runSandboxCreate,
  runSandboxDestroy,
  runSandboxExec,
  runSandboxJob,
  runSandboxList,
  runSandboxPause,
  runSandboxPreview,
  runSandboxResume,
  runSandboxSetup,
  runSandboxSnapshotDelete,
  runSandboxSnapshotList,
  runSandboxSnapshotSave,
  runSandboxSync,
} from "./cmd/sandbox.js";
import { runMove, runMoves, runReturn, runSetup, runT3Link, runT3Unlink } from "./cmd/move.js";
import { runProjectReset, runProjectSet, runProjectStatus } from "./cmd/project.js";
import {
  runCurrentWorkspaceInfo,
  runPortClose,
  runPortList,
  runPortOpen,
  runPortVisibility,
} from "./cmd/current-workspace.js";

const jsonOption = {
  json: {
    type: "boolean" as const,
    description: "Output machine-readable JSON",
    default: false,
  },
};

const sandboxOptions = {
  ...jsonOption,
  account: { type: "string" as const, description: "Sandbox account from the settings file" },
};
/** The checkout a sandbox command works on, and the agent session it runs for. */
const checkoutOption = {
  dir: { type: "string" as const, description: "Checkout directory (default: cwd)" },
};
const sessionOption = {
  session: {
    type: "string" as const,
    description: "The agent session this is for, saved with the sandbox and its jobs",
  },
};
const yesOption = {
  yes: { alias: "y", type: "boolean" as const, description: "Approve without prompting" },
};
/** Approve, and stop asking for creating, syncing and applying in this project. */
const alwaysOption = {
  always: {
    type: "boolean" as const,
    description: "Approve, and stop asking for this in this project (on this machine)",
  },
};

const cli = yargs(hideBin(process.argv)).scriptName("gitterm").usage("$0 <command> [options]");

let workspaceEnvironment = null;
try {
  workspaceEnvironment = getWorkspaceEnvironment();
} catch (error) {
  handleError(error);
}

if (workspaceEnvironment) {
  cli
    .command("workspace", "Inspect this workspace", (workspace) =>
      workspace
        .command(
          "info",
          "Show this workspace",
          (builder) => builder.options(jsonOption),
          (argv) => runCurrentWorkspaceInfo({ json: argv.json }),
        )
        .demandCommand(1, "Please specify a workspace command")
        .strict(),
    )
    .command(["ports", "port"], "Manage ports for this workspace", (ports) =>
      ports
        .command(
          "list",
          "List open ports",
          (builder) => builder.options(jsonOption),
          (argv) => runPortList({ json: argv.json }),
        )
        .command(
          "open <port>",
          "Open a port",
          (builder) =>
            builder
              .positional("port", { type: "number", demandOption: true })
              .option("name", { type: "string", description: "Display name" })
              .option("public", {
                type: "boolean",
                description: "Allow anyone with the URL to reach the port (default: private)",
              })
              .options(jsonOption),
          (argv) =>
            runPortOpen({
              port: argv.port,
              name: argv.name,
              visibility:
                argv.public === undefined ? undefined : argv.public ? "public" : "private",
              json: argv.json,
            }),
        )
        .command(
          "visibility <port> <visibility>",
          "Make a port private (owner only) or public (anyone with the URL)",
          (builder) =>
            builder
              .positional("port", { type: "number", demandOption: true })
              .positional("visibility", {
                choices: ["private", "public"] as const,
                demandOption: true,
              })
              .options(jsonOption),
          (argv) =>
            runPortVisibility({ port: argv.port, visibility: argv.visibility, json: argv.json }),
        )
        .command(
          "close <port>",
          "Close a port",
          (builder) =>
            builder.positional("port", { type: "number", demandOption: true }).options(jsonOption),
          (argv) => runPortClose({ port: argv.port, json: argv.json }),
        )
        .demandCommand(1, "Please specify a port command")
        .strict(),
    );
} else {
  cli
    .command(
      "login",
      "Sign in via device-code flow",
      (builder) =>
        builder.option("server", {
          alias: "s",
          type: "string",
          description: "Server base URL",
          default: DEFAULT_GITTERM_SERVER_URL,
        }),
      async (argv) => {
        await runLogin({ serverUrl: argv.server }).catch((err) => handleError(err));
      },
    )
    .command(
      "logout",
      "Clear saved credentials",
      () => {},
      async () => {
        await runLogout().catch((err) => handleError(err));
      },
    )
    .command("auth", "Manage authentication", (auth) =>
      auth
        .command(
          "status",
          "Show the logged-in account",
          (builder) => builder.options(jsonOption),
          async (argv) => {
            await runAuthStatus({ json: argv.json });
          },
        )
        .demandCommand(1, "Please specify an auth command")
        .strict(),
    )
    .command(
      "setup",
      "Set up your agents to move sessions to GitTerm, and sign in",
      (b) =>
        b.options({
          ...jsonOption,
          yes: {
            type: "boolean",
            default: false,
            description: "Set up every agent found without asking, and skip sign-in",
          },
        }),
      (argv) => runSetup(argv),
    )
    .command(
      "move [message]",
      "Move an agent's session (this one, from inside it) and its checkout to a new workspace",
      (b) =>
        b
          .positional("message", {
            type: "string",
            describe: "What the cloud agent should do next",
          })
          .options({
            ...jsonOption,
            agent: {
              type: "string",
              description: "The session's agent (default: the one running this)",
            },
            session: {
              type: "string",
              description: "Session to move (default: the one running this)",
            },
            changes: {
              type: "boolean",
              default: true,
              description: "Bring uncommitted changes (--no-changes leaves them here)",
            },
            provider: {
              type: "string",
              description: "Provider (e2b, daytona, vercel, boat, exedev, gitterm)",
            },
            connection: {
              type: "array",
              string: true,
              description: "Connections to attach, e.g. github",
            },
          }),
      (argv) => runMove(argv),
    )
    .command(
      "return [workspaceId]",
      "Bring a moved session back: the cloud's commits, changes and conversation",
      (b) =>
        b.positional("workspaceId", { type: "string" }).options({
          ...jsonOption,
          session: {
            type: "string",
            description: "The local session to bring back (default: this one, or the only one)",
          },
          force: {
            type: "boolean",
            default: false,
            description: "Replace local work made since the move (it is kept)",
          },
          end: {
            choices: ["pause", "delete", "keep"] as const,
            default: "pause" as const,
            description: "What happens to the workspace afterwards",
          },
          message: { type: "string", description: "What the local agent should do next" },
          detached: { type: "boolean", hidden: true, default: false },
        }),
      (argv) => runReturn(argv),
    )
    .command(
      "moves",
      "List sessions from this machine that are in the cloud",
      (b) => b.options(jsonOption),
      (argv) => runMoves(argv),
    )
    .command("t3", "T3 Code extras", (t3) =>
      t3
        .command(
          "link",
          "Create a workspace for this repository and link it to T3 Code for delegate_task",
          (b) =>
            b.options({
              ...jsonOption,
              repo: {
                type: "string",
                description: "Repository URL (default: this checkout's origin)",
              },
              ref: { type: "string", description: "Branch to check out" },
              access: {
                choices: [
                  "read-only",
                  "approval-required",
                  "auto-accept-edits",
                  "auto",
                  "full-access",
                ] as const,
                default: "full-access",
                description: "The most agents here may do there",
              },
              provider: {
                type: "string",
                description: "Provider (e2b, daytona, vercel, boat, exedev, gitterm)",
              },
              connection: {
                type: "array",
                string: true,
                description: "Connections to attach, e.g. github",
              },
            }),
          (argv) => runT3Link(argv),
        )
        .command(
          "unlink <workspaceId>",
          "Unlink a workspace from T3 Code and delete it",
          (b) =>
            b.positional("workspaceId", { type: "string", demandOption: true }).options({
              ...jsonOption,
              pause: { type: "boolean", description: "Pause instead of deleting" },
            }),
          (argv) => runT3Unlink(argv),
        )
        .demandCommand(1, "Please specify a t3 command")
        .strict(),
    )
    .command("project", "Turn sandboxes or cloud moves on or off for this project", (project) =>
      project
        .command(
          ["status", "$0"],
          "Show what this project allows",
          (b) => b.options(jsonOption),
          (argv) => runProjectStatus(argv),
        )
        .command(
          "disable <feature>",
          "Turn sandboxes, cloud moves, or all of GitTerm off for this project",
          (b) =>
            b
              .positional("feature", {
                choices: ["sandbox", "cloud", "all"] as const,
                demandOption: true,
              })
              .options(jsonOption),
          (argv) => runProjectSet({ ...argv, on: false }),
        )
        .command(
          "enable <feature>",
          "Turn sandboxes, cloud moves, or all of GitTerm back on for this project",
          (b) =>
            b
              .positional("feature", {
                choices: ["sandbox", "cloud", "all"] as const,
                demandOption: true,
              })
              .options(jsonOption),
          (argv) => runProjectSet({ ...argv, on: true }),
        )
        .command(
          "reset",
          "Forget this project's settings: everything on, and sandbox steps ask again",
          (b) => b.options(jsonOption),
          (argv) => runProjectReset(argv),
        )
        .strict(),
    )
    .command(["sandbox", "sb"], "Run commands in remote sandboxes (no remote agent)", (sandbox) =>
      sandbox
        .options(sandboxOptions)
        .command(
          "setup",
          "Choose where sandboxes run: your Gitterm plan or your own provider account",
          (b) => b,
          () => runSandboxSetup(),
        )
        .command(
          "account",
          "Show the selected mode, account, and who is charged",
          (b) => b.options(sandboxOptions),
          (argv) => runSandboxAccount(argv),
        )
        .command(
          "create",
          "Create a billable sandbox",
          (b) =>
            b.options({
              name: { type: "string" },
              purpose: {
                type: "string",
                description: "Why it exists, e.g. 'run integration tests'",
              },
              lifetime: {
                type: "number",
                description:
                  "Minutes the sandbox lives (what happens then depends on the provider)",
              },
              public: { type: "boolean", description: "Public previews (fixed at creation)" },
              snapshot: {
                type: "string",
                description:
                  "Setup snapshot to start from, or 'none' (default: the newest for this checkout)",
              },
              ...checkoutOption,
              ...sessionOption,
              ...yesOption,
              ...alwaysOption,
            }),
          (argv) => runSandboxCreate(argv),
        )
        .command(
          "list",
          "List live sandboxes for the account",
          (b) => b.options(sandboxOptions),
          (argv) => runSandboxList(argv),
        )
        .command(
          "sync <sandboxId>",
          "Upload the current checkout (including uncommitted changes)",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .options({ ...checkoutOption, ...yesOption, ...alwaysOption }),
          (argv) => runSandboxSync(argv),
        )
        .command(
          "exec <sandboxId> <command>",
          "Run a command as a durable job",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("command", { type: "string", demandOption: true })
              .options({
                cwd: {
                  type: "string",
                  description: "Relative to the synced project directory, or absolute",
                },
                timeout: { type: "number", description: "Minutes before the job is killed" },
                wait: {
                  type: "number",
                  description: "Seconds to wait for completion (default 60)",
                },
                background: {
                  type: "boolean",
                  description: "Return at once; read the job later with `gitterm sandbox job`",
                },
                "secret-env": {
                  type: "string",
                  array: true,
                  description: "A local environment variable to pass (needs approval)",
                },
                ...checkoutOption,
                ...sessionOption,
                ...yesOption,
              }),
          (argv) => runSandboxExec(argv),
        )
        .command(
          "job <sandboxId> <jobId>",
          "Show job status and output",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("jobId", { type: "string", demandOption: true })
              .options({
                offset: { type: "number" },
                limit: { type: "number" },
                wait: { type: "number", description: "Seconds to wait for completion" },
              }),
          (argv) => runSandboxJob(argv),
        )
        .command(
          "cancel <sandboxId> <jobId>",
          "Cancel a running job",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("jobId", { type: "string", demandOption: true }),
          (argv) => runSandboxCancel(argv),
        )
        .command(
          "preview <sandboxId> <port>",
          "Wait for a port to answer and print its URL",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("port", { type: "number", demandOption: true })
              .options({
                command: { type: "string", description: "Server command to start first" },
                cwd: { type: "string", description: "Where the server command runs" },
                public: {
                  type: "boolean",
                  description:
                    "Make this port public (needs approval), or private again with --no-public",
                },
                serve: {
                  type: "boolean",
                  description: "Serve a private preview on a loopback URL",
                },
                ...checkoutOption,
                ...yesOption,
              }),
          (argv) => runSandboxPreview(argv),
        )
        .command(
          "artifact <sandboxId> <jobId> <path>",
          "Download a file a job produced into a local staging directory",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("jobId", { type: "string", demandOption: true })
              .positional("path", { type: "string", demandOption: true }),
          (argv) => runSandboxArtifact(argv),
        )
        .command(
          "apply <sandboxId> <artifact> <target>",
          "Copy a downloaded artifact into its job's checkout (refuses stale targets)",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("artifact", { type: "string", demandOption: true })
              .positional("target", { type: "string", demandOption: true })
              .options({ ...yesOption, ...alwaysOption }),
          (argv) => runSandboxApply(argv),
        )
        .command(
          "resume <sandboxId>",
          "Resume a managed sandbox paused for inactivity",
          (b) => b.positional("sandboxId", { type: "string", demandOption: true }),
          (argv) => runSandboxResume(argv),
        )
        .command(
          "pause <sandboxId>",
          "Pause a sandbox to stop billing; its files are kept and using it resumes it",
          (b) => b.positional("sandboxId", { type: "string", demandOption: true }),
          (argv) => runSandboxPause(argv),
        )
        .command("snapshot", "Setup snapshots new sandboxes can start from", (snapshot) =>
          snapshot
            .command(
              "list",
              "List the setup snapshots for this checkout",
              (b) => b.options(checkoutOption),
              (argv) => runSandboxSnapshotList(argv),
            )
            .command(
              "save <sandboxId>",
              "Save a sandbox's setup as a snapshot",
              (b) =>
                b.positional("sandboxId", { type: "string", demandOption: true }).options({
                  label: {
                    type: "string",
                    demandOption: true,
                    description: "What it holds, e.g. 'deps + postgres'",
                  },
                  note: { type: "string", description: "What is set up in it" },
                  "any-project": {
                    type: "boolean",
                    description: "Offer it to every checkout, not only this one",
                  },
                  replace: { type: "string", description: "A snapshot this one replaces" },
                  ...checkoutOption,
                }),
              (argv) => runSandboxSnapshotSave(argv),
            )
            .command(
              "delete <snapshotId>",
              "Delete a setup snapshot",
              (b) => b.positional("snapshotId", { type: "string", demandOption: true }),
              (argv) => runSandboxSnapshotDelete(argv),
            )
            .demandCommand(1, "Please specify a snapshot command")
            .strict(),
        )
        .command(
          "destroy <sandboxId>",
          "Delete a sandbox and confirm it is gone",
          (b) => b.positional("sandboxId", { type: "string", demandOption: true }),
          (argv) => runSandboxDestroy(argv),
        )
        .demandCommand(1, "Please specify a sandbox command")
        .strict(),
    )
    .command(["workspace", "ws"], "Manage workspaces", (workspace) =>
      workspace
        .command(
          "list",
          "List your workspaces",
          (builder) =>
            builder.options(jsonOption).options({
              status: {
                type: "string",
                choices: ["active", "all", "terminated"] as const,
                description: "Filter by workspace status",
                default: "active",
              },
              limit: {
                type: "number",
                description: "Maximum number of workspaces to return",
              },
            }),
          async (argv) => {
            await runWorkspaceList({ json: argv.json, status: argv.status, limit: argv.limit });
          },
        )
        .command(
          "get <workspaceId>",
          "Show details for a workspace",
          (builder) =>
            builder
              .positional("workspaceId", { type: "string", demandOption: true })
              .options(jsonOption),
          async (argv) => {
            await runWorkspaceGet({ json: argv.json, workspaceId: argv.workspaceId });
          },
        )
        .command(
          "pause <workspaceId>",
          "Pause a running workspace",
          (builder) =>
            builder
              .positional("workspaceId", { type: "string", demandOption: true })
              .options(jsonOption),
          async (argv) => {
            await runWorkspacePause({ json: argv.json, workspaceId: argv.workspaceId });
          },
        )
        .command(
          "stop <workspaceId>",
          "Alias for pause",
          (builder) =>
            builder
              .positional("workspaceId", { type: "string", demandOption: true })
              .options(jsonOption),
          async (argv) => {
            await runWorkspacePause({ json: argv.json, workspaceId: argv.workspaceId });
          },
        )
        .command(
          "restart <workspaceId>",
          "Restart a paused workspace",
          (builder) =>
            builder
              .positional("workspaceId", { type: "string", demandOption: true })
              .options(jsonOption),
          async (argv) => {
            await runWorkspaceRestart({ json: argv.json, workspaceId: argv.workspaceId });
          },
        )
        .command(
          "terminate <workspaceId>",
          "Terminate a workspace permanently",
          (builder) =>
            builder
              .positional("workspaceId", { type: "string", demandOption: true })
              .options(jsonOption)
              .option("yes", {
                alias: "y",
                type: "boolean",
                description: "Skip the confirmation prompt",
                default: false,
              }),
          async (argv) => {
            await runWorkspaceTerminate({
              json: argv.json,
              workspaceId: argv.workspaceId,
              yes: argv.yes,
            });
          },
        )
        .demandCommand(1, "Please specify a workspace command")
        .strict(),
    );
}

cli
  .demandCommand(1, "Please specify a command")
  .help()
  .alias("help", "h")
  .version(pkg.version)
  .alias("version", "v")
  .wrap(Math.min(100, process.stdout.columns ?? 100))
  .strict()
  .parse();
