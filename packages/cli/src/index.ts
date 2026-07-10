#!/usr/bin/env bun
import { DEFAULT_GITTERM_SERVER_URL } from "@gitterm/sdk";
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

const jsonOption = {
  json: {
    type: "boolean" as const,
    description: "Output machine-readable JSON",
    default: false,
  },
};

yargs(hideBin(process.argv))
  .scriptName("gitterm")
  .usage("$0 <command> [options]")
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
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .alias("help", "h")
  .version(pkg.version)
  .alias("version", "v")
  .wrap(Math.min(100, process.stdout.columns ?? 100))
  .strict()
  .parse();
