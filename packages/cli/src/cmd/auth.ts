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
  try {
    const email = await signIn(args.serverUrl);
    success(email ? `Logged in as ${chalk.bold(email)}` : "Logged in successfully!");
  } catch (err) {
    handleError(err);
  }
}

/**
 * Signs in with a device code: the page it opens also creates an account. Returns the
 * account's email when GitTerm says it.
 */
export async function signIn(serverUrl: string): Promise<string | undefined> {
  let spin = startSpinner("Requesting device code...");
  try {
    const { token } = await loginWithDeviceCode(serverUrl, {
      onCode: (code) => {
        spin?.stop();
        const url = new URL(code.verificationUri);
        url.searchParams.set("code", code.userCode);
        console.log(`\nTo sign in, visit ${chalk.cyan(url.href)}`);
        console.log(`and approve code: ${chalk.bold(code.userCode)}\n`);
        spin = startSpinner("Waiting for approval...");
      },
    });
    spin?.stop();

    await saveConfig({ serverUrl, token, createdAt: Date.now() });
    // Best-effort identity lookup so the success message names the account.
    return await createGittermClient({ serverUrl, token })
      .auth.status()
      .then((status) => status.email)
      .catch(() => undefined);
  } finally {
    spin?.stop();
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
