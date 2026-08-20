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
  runCurrentWorkspaceInfo,
  runPortClose,
  runPortList,
  runPortOpen,
} from "./cmd/current-workspace.js";

const jsonOption = {
  json: {
    type: "boolean" as const,
    description: "Output machine-readable JSON",
    default: false,
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
              .options(jsonOption),
          (argv) => runPortOpen({ port: argv.port, name: argv.name, json: argv.json }),
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
