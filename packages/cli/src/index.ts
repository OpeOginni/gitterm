#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runTunnel } from "./cmd/tunnel.js";
import { loginViaDeviceCode, saveConfig, deleteConfig } from "./cmd/auth.js";
import { sync } from "./cmd/sync.js";

// Default production URLs (hosted gitterm.dev)
const DEFAULT_SERVER_URL = "https://api.gitterm.dev";

type LoginArgs = {
  serverUrl: string;
};

async function runLogin(args: LoginArgs) {
  console.log(`Logging in to gitterm...`);

  const { cliToken } = await loginViaDeviceCode(args.serverUrl);
  await saveConfig({ serverUrl: args.serverUrl, cliToken, createdAt: Date.now() });
  console.log("Logged in successfully!");
  process.exit(0);
}

async function runLogout() {
  await deleteConfig();
  console.log("Logged out successfully. Credentials cleared.");
  process.exit(0);
}

// CLI setup with yargs
yargs(hideBin(process.argv))
  .scriptName("gitterm")
  .usage("$0 <command> [options]")
  .command(
    "login",
    "Sign in via device-code flow",
    (yargs) => {
      return yargs.option("server", {
        alias: "s",
        type: "string",
        description: "Server base URL",
        default: DEFAULT_SERVER_URL,
      });
    },
    async (argv) => {
      try {
        await runLogin({ serverUrl: argv.server });
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .command(
    "logout",
    "Clear saved credentials",
    () => {},
    async () => {
      try {
        await runLogout();
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .command(
    "tunnel",
    "Connect a local port to your workspace",
    (yargs) => {
      return yargs
        .option("workspace-id", {
          alias: "w",
          type: "string",
          description: "Workspace ID",
          demandOption: true,
        })
        .option("port", {
          alias: "p",
          type: "number",
          description: "Local port to expose",
        })
        .option("ws-url", {
          type: "string",
          description: "Tunnel-proxy WebSocket URL",
        })
        .option("server-url", {
          alias: "s",
          type: "string",
          description: "Server base URL",
          default: DEFAULT_SERVER_URL,
        })
        .option("token", {
          alias: "t",
          type: "string",
          description: "Tunnel JWT (overrides saved login)",
        })
        .option("expose", {
          alias: "e",
          type: "array",
          string: true,
          description: "Expose additional service port (name=port)",
        });
    },
    async (argv) => {
      try {
        await runTunnel({
          workspaceId: argv.workspaceId,
          port: argv.port,
          wsUrl: argv.wsUrl,
          serverUrl: argv.serverUrl,
          token: argv.token,
          expose: argv.expose,
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .command(
    "sync",
    "Sync a project to your workspace",
    (yargs) => {
      return yargs.option("server", {
        alias: "s",
        type: "string",
        description: "Server base URL",
        default: DEFAULT_SERVER_URL,
      });
    },
    async (argv) => {
      try {
        await sync(argv.server);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
    },
  )
  .demandCommand(1, "Please specify a command")
  .help()
  .alias("help", "h")
  .version(false)
  .strict()
  .parse();
