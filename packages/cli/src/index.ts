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
  runSandboxPreview,
  runSandboxSync,
} from "./cmd/sandbox.js";
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
    .command(["sandbox", "sb"], "Run commands in remote sandboxes (no remote agent)", (sandbox) =>
      sandbox
        .options(sandboxOptions)
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
              lifetime: { type: "number", description: "Minutes until deletion" },
              public: { type: "boolean", description: "Public previews (fixed at creation)" },
              yes: { alias: "y", type: "boolean", description: "Approve without prompting" },
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
            b.positional("sandboxId", { type: "string", demandOption: true }).options({
              dir: { type: "string", description: "Checkout directory (default: cwd)" },
              yes: { alias: "y", type: "boolean" },
            }),
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
                cwd: { type: "string" },
                timeout: { type: "number", description: "Minutes before the job is killed" },
                wait: {
                  type: "number",
                  description: "Seconds to wait for completion (default 60)",
                },
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
                serve: {
                  type: "boolean",
                  description: "Serve a private preview on a loopback URL",
                },
              }),
          (argv) => runSandboxPreview(argv),
        )
        .command(
          "artifact <sandboxId> <path>",
          "Download a file into a local staging directory",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("path", { type: "string", demandOption: true }),
          (argv) => runSandboxArtifact(argv),
        )
        .command(
          "apply <sandboxId> <artifact> <sha256> <target>",
          "Copy a downloaded artifact into the checkout (refuses stale targets)",
          (b) =>
            b
              .positional("sandboxId", { type: "string", demandOption: true })
              .positional("artifact", { type: "string", demandOption: true })
              .positional("sha256", { type: "string", demandOption: true })
              .positional("target", { type: "string", demandOption: true })
              .options({ yes: { alias: "y", type: "boolean" } }),
          (argv) => runSandboxApply(argv),
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
