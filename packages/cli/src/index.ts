#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { loginViaDeviceCode, saveConfig, deleteConfig } from "./cmd/auth.js";

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
  .demandCommand(1, "Please specify a command")
  .help()
  .alias("help", "h")
  .version(false)
  .strict()
  .parse();
