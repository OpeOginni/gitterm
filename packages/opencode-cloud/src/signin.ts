import type { OpenCodeClient } from "@opencode/client";
import {
  createGittermClient,
  DEFAULT_GITTERM_SERVER_URL,
  GittermError,
  loadConfig,
  loginWithDeviceCode,
  saveConfig,
  type GittermClient,
} from "@gitterm/sdk";
import { askForm, HandoffCancelled, type HandoffOptions } from "./handoff";
import { SIGN_IN_KEY } from "./marker";

export async function signedIn(
  local: OpenCodeClient,
  sessionID: string,
  options: Pick<HandoffOptions, "serverUrl" | "token">,
  signal: AbortSignal,
): Promise<GittermClient> {
  const connect = () => createGittermClient({ serverUrl: options.serverUrl, token: options.token });
  try {
    const client = connect();
    await client.auth.status();
    return client;
  } catch (error) {
    const signedOut =
      error instanceof GittermError &&
      (error.code === "NOT_LOGGED_IN" || error.code === "UNAUTHORIZED");
    // A token from the settings or the environment would still win over a new login.
    if (!signedOut || options.token || process.env.GITTERM_API_TOKEN?.trim()) throw error;
  }

  const serverUrl =
    options.serverUrl ??
    process.env.GITTERM_SERVER_URL ??
    (await loadConfig())?.serverUrl ??
    DEFAULT_GITTERM_SERVER_URL;
  // Closing the dialog stops the wait; signing in closes the dialog.
  const closed = new AbortController();
  const done = new AbortController();
  let dialog: Promise<void> | undefined;
  let failure: unknown;
  try {
    const { token } = await loginWithDeviceCode(serverUrl, {
      clientName: "OpenCode",
      signal: AbortSignal.any([signal, closed.signal]),
      onCode: ({ verificationUri, userCode }) => {
        const url = new URL(verificationUri);
        url.searchParams.set("code", userCode);
        dialog = askForm(
          local,
          sessionID,
          "Sign in to GitTerm",
          [
            {
              key: SIGN_IN_KEY,
              type: "external",
              url: url.href,
              title: "Sign in to GitTerm",
              description: `Sign in or create an account, then approve code ${userCode}. This closes by itself once you do.`,
            },
          ],
          AbortSignal.any([signal, done.signal]),
        ).then(
          // Submitting the native form doesn't end device approval; cancelling does.
          () => {},
          (error: unknown) => {
            if (done.signal.aborted) return;
            if (!(error instanceof HandoffCancelled)) failure = error;
            closed.abort();
          },
        );
      },
    });
    await saveConfig({ serverUrl, token, createdAt: Date.now() });
  } catch (error) {
    if (failure) throw failure;
    if (closed.signal.aborted && !signal.aborted) throw new HandoffCancelled();
    throw error;
  } finally {
    done.abort();
    await dialog;
  }
  return connect();
}

/** GitTerm's web app: gitterm.dev for api.gitterm.dev; a self-hosted server serves both. */
export function dashboardUrl(serverUrl: string, path: string): string {
  const url = new URL(serverUrl);
  if (url.hostname.startsWith("api.")) url.hostname = url.hostname.slice(4);
  return new URL(path, url.origin).href;
}

export async function confirmNoModels(
  local: OpenCodeClient,
  gitterm: GittermClient,
  sessionID: string,
  signal: AbortSignal,
): Promise<void> {
  const saved = await gitterm.credentials.list().catch(() => undefined);
  if (!saved || saved.some((credential) => credential.isActive)) return;
  const choice = await askForm(
    local,
    sessionID,
    "You have no models in GitTerm",
    [
      {
        key: "models",
        type: "string",
        title: "You have no models in GitTerm",
        description: `Your model keys stay on this machine. The cloud agent uses the models you add at ${dashboardUrl(gitterm.serverUrl, "/dashboard/models")}`,
        options: [
          { value: "stop", label: "Stop, I'll add one first" },
          { value: "continue", label: "Continue with the cloud's own models" },
        ],
        required: true,
      },
    ],
    signal,
  );
  if (choice.models !== "continue") throw new HandoffCancelled();
}
