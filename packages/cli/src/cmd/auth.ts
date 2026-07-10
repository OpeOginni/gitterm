import {
  createGittermClient,
  deleteConfig,
  getConfigPath,
  loadConfig,
  loginWithDeviceCode,
  saveConfig,
} from "@gitterm/sdk";
import chalk from "chalk";
import { handleError, printJson, startSpinner, success } from "../ui.js";

export async function runLogin(args: { serverUrl: string }) {
  let spin = startSpinner("Requesting device code...");

  try {
    const { token } = await loginWithDeviceCode(args.serverUrl, {
      onCode: (code) => {
        spin?.stop();
        console.log(`\nTo sign in, visit ${chalk.cyan(code.verificationUri)}`);
        console.log(`and enter code: ${chalk.bold(code.userCode)}\n`);
        spin = startSpinner("Waiting for approval...");
      },
    });
    spin?.stop();

    await saveConfig({
      serverUrl: args.serverUrl,
      token,
      createdAt: Date.now(),
    });

    // Best-effort identity lookup so the success message names the account.
    try {
      const status = await createGittermClient({
        serverUrl: args.serverUrl,
        token,
      }).auth.status();
      success(`Logged in as ${chalk.bold(status.email)}`);
    } catch {
      success("Logged in successfully!");
    }
  } catch (err) {
    spin?.stop();
    handleError(err);
  }
}

export async function runLogout() {
  await deleteConfig();
  success("Logged out. Credentials cleared.");
}

export async function runAuthStatus(args: { json?: boolean }) {
  const spin = startSpinner("Checking authentication...", args.json);
  try {
    const client = createGittermClient();
    const status = await client.auth.status();
    spin?.stop();

    if (args.json) {
      printJson({ ...status, serverUrl: client.serverUrl });
      return;
    }

    success(`Logged in as ${chalk.bold(status.email)}`);
    console.log(`${chalk.dim("Name:".padEnd(12))} ${status.name}`);
    console.log(`${chalk.dim("Plan:".padEnd(12))} ${status.plan}`);
    console.log(`${chalk.dim("Server:".padEnd(12))} ${client.serverUrl}`);
  } catch (err) {
    spin?.stop();
    handleError(err, args.json);
  }
}

export { deleteConfig, getConfigPath, loadConfig };
