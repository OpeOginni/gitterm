import { GittermError, type GittermClient } from "@gitterm/sdk";
import type { BotLogger, ModelChoice, WorkspaceOverrides } from "./types.js";
import { modelsFor, repoLabel, type Repo } from "./workspaces.js";

export const BOT_TOKEN_SCOPES = [
  "identity:read",
  "workspace:read",
  "workspace:write",
  "run:read",
  "run:write",
  "integrations:read",
] as const;

const SETUP_HINT = "Fix it in the GitTerm dashboard under Bots, then restart the bot.";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Everything a first mention would need, checked before the bot connects, so a misconfigured
 * bot fails at startup with what to fix instead of in a Slack thread later. Problems that only
 * matter for some requests (a public repository without GitHub access) are warnings.
 */
export async function checkSetup(input: {
  gitterm: GittermClient;
  repos: Repo[];
  connections: string[];
  model: ModelChoice | undefined;
  overrides: WorkspaceOverrides | undefined;
  log: BotLogger;
}): Promise<void> {
  const { gitterm, log } = input;
  const ok: string[] = [];
  const warnings: string[] = [];
  const problems: string[] = [];

  try {
    const me = await gitterm.auth.status();
    ok.push(`GitTerm: ${me.email} on ${gitterm.serverUrl}`);
  } catch (error) {
    const code = error instanceof GittermError ? error.code : undefined;
    // Without a working token every other check fails the same way.
    throw new Error(
      code === "UNAUTHORIZED" || code === "NOT_LOGGED_IN"
        ? `GitTerm did not accept the API token (GITTERM_API_TOKEN). ${SETUP_HINT}`
        : code === "FORBIDDEN"
          ? `The GitTerm API token is missing scopes; a bot token needs ${BOT_TOKEN_SCOPES.join(", ")}. ${SETUP_HINT}`
          : `Could not reach GitTerm at ${gitterm.serverUrl}: ${reason(error)}`,
      { cause: error },
    );
  }

  const checks: Array<Promise<void>> = [];
  checks.push(
    gitterm.catalog.workspaceOptions().then((catalog) => {
      const wanted = input.overrides?.provider?.type;
      const provider = wanted
        ? catalog.providers.find((entry) => entry.type === wanted)
        : (catalog.providers.find((entry) => entry.isDefault) ?? catalog.providers[0]);
      if (provider) ok.push(`Sandboxes: ${provider.name}`);
      else if (wanted) problems.push(`The ${wanted} compute provider is not available to you.`);
      else problems.push("No compute provider is enabled for your account; ask your admin.");
    }),
  );

  if (input.model) {
    const model = input.model;
    checks.push(
      (model.apiKey || model.credential ? Promise.resolve([]) : gitterm.credentials.list()).then(
        (saved) => {
          const models = modelsFor(model, saved);
          const source = model.apiKey
            ? "API key from the bot's settings"
            : model.credential
              ? `saved credential "${model.credential}"`
              : models.providers
                ? "your default saved credential"
                : undefined;
          if (source) ok.push(`Model: ${model.id} (${source})`);
          else {
            warnings.push(
              `No saved ${model.id.split("/")[0]} credential, so ${model.id} only works if it needs no key. Add one under Bots → Model.`,
            );
          }
        },
      ),
    );
  } else {
    warnings.push("No model chosen: sandboxes get every saved model credential. Set a model.");
  }

  for (const repo of input.repos) {
    const label = repoLabel(repo);
    checks.push(
      gitterm.integrations.connections.resolve(["github"], { repo: repo.url }).then(
        ([github]) => void ok.push(`${label}: GitHub via ${github?.name ?? "GitHub"}`),
        (error: unknown) =>
          void warnings.push(
            `${label}: no GitHub access (${reason(error)}) Public repositories still work; private ones and pull requests do not.`,
          ),
      ),
    );
    if (input.connections.length) {
      checks.push(
        gitterm.integrations.connections.resolve(input.connections, { repo: repo.url }).then(
          (tools) => void ok.push(`${label}: tools ${tools.map((tool) => tool.name).join(", ")}`),
          (error: unknown) => void problems.push(`${label}: ${reason(error)}`),
        ),
      );
    }
  }

  const failures = (await Promise.allSettled(checks)).flatMap((result) =>
    result.status === "rejected" ? [reason(result.reason)] : [],
  );
  problems.push(...failures);
  for (const line of ok) log.info(`✓ ${line}`);
  for (const line of warnings) log.warn(`! ${line}`);
  if (problems.length) {
    throw new Error(
      `The bot is not ready:\n${problems.map((line) => `  ✗ ${line}`).join("\n")}\n${SETUP_HINT}`,
    );
  }
}
