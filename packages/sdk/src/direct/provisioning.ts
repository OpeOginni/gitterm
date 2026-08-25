import type {
  DirectAgentFile,
  DirectProviderWorkspaceInput,
  DirectProvisioningPlan,
  DirectModelCredential,
  DirectWorkspaceCreateInput,
  DirectWorkspaceRuntime,
} from "./types.js";

export const DIRECT_OPENCODE_PORT = 4096;
export const DIRECT_OPENCODE_COMMAND = `opencode serve --hostname 0.0.0.0 --port ${DIRECT_OPENCODE_PORT}`;

export function directModelAuth(credential: DirectModelCredential) {
  if (credential.type === "oauth") {
    if (!credential.refreshToken.trim()) throw new Error("OAuth refreshToken is required");
    if (
      credential.expiresAt != null &&
      (!Number.isFinite(credential.expiresAt) || credential.expiresAt < 0)
    ) {
      throw new Error("OAuth expiresAt must be a non-negative Unix epoch time in milliseconds");
    }
    return {
      type: "oauth" as const,
      refresh: credential.refreshToken,
      access: credential.accessToken ?? "",
      expires: credential.expiresAt ?? 0,
      ...(credential.accountId ? { accountId: credential.accountId } : {}),
      ...(credential.enterpriseUrl ? { enterpriseUrl: credential.enterpriseUrl } : {}),
    };
  }
  if (!credential.apiKey.trim()) throw new Error("Model credential apiKey is required");
  return {
    type: "api" as const,
    key: credential.apiKey,
    ...(credential.metadata ? { metadata: credential.metadata } : {}),
  };
}

function base64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function validateName(value: string, kind: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${kind}: ${value}`);
  }
  return value;
}

export function repositoryName(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const name =
    pathname
      .replace(/\/$/, "")
      .split("/")
      .at(-1)
      ?.replace(/\.git$/, "") ?? "";
  return validateName(name, "repository name");
}

export function buildDirectProvisioningPlan(
  input: DirectWorkspaceCreateInput & {
    id: string;
    lifecycle: DirectProviderWorkspaceInput["lifecycle"];
    password: string;
  },
): DirectProvisioningPlan {
  if (input.baseCommit && !input.repo) throw new Error("baseCommit requires repo");
  const credentials = new Map<string, ReturnType<typeof directModelAuth>>();
  for (const credential of input.modelCredentials ?? []) {
    if (!credential.providerName.trim())
      throw new Error("Model credential providerName is required");
    if (credentials.has(credential.providerName)) {
      throw new Error(`Duplicate model credential: ${credential.providerName}`);
    }
    credentials.set(credential.providerName, directModelAuth(credential));
  }
  const configuredPlugins = Array.isArray(input.opencode?.config?.plugin)
    ? input.opencode.config.plugin.filter((plugin): plugin is string => typeof plugin === "string")
    : [];
  const plugins = [...new Set([...configuredPlugins, ...(input.opencode?.plugins ?? [])])];
  const config = {
    $schema: "https://opencode.ai/config.json",
    ...input.opencode?.config,
    username: "Gitterm direct",
    ...(plugins.length ? { plugin: plugins } : {}),
  };
  const files: DirectAgentFile[] = [
    {
      path: "~/.local/share/opencode/auth.json",
      contentBase64: base64(JSON.stringify(Object.fromEntries(credentials))),
    },
    {
      path: "~/.config/opencode/opencode.json",
      contentBase64: base64(JSON.stringify(config)),
    },
    {
      path: "~/.config/opencode/AGENTS.md",
      contentBase64: base64(
        "You are running in a direct Gitterm workspace. Follow the user's instructions and verify outcomes before reporting success.",
      ),
    },
    ...(input.opencode?.skills ?? []).map((skill) => ({
      path: `~/.config/opencode/skills/${validateName(skill.name, "skill name")}/SKILL.md`,
      contentBase64: base64(skill.content),
    })),
  ];
  return {
    workspaceId: input.id,
    lifecycle: input.lifecycle,
    repository: input.repo
      ? {
          url: input.repo,
          name: repositoryName(input.repo),
          branch: input.branch,
          checkoutRef: input.checkoutRef,
          baseCommit: input.baseCommit,
          authUsername: input.repositoryCredentials?.username,
          authToken: input.repositoryCredentials?.token,
        }
      : undefined,
    agent: {
      files,
      environmentVariables: {
        ...input.environmentVariables,
        OPENCODE_SERVER_PASSWORD: input.password,
      },
      command: DIRECT_OPENCODE_COMMAND,
      port: DIRECT_OPENCODE_PORT,
    },
    setupCommands: input.setupCommands ?? [],
  };
}

export function containerEnvironment(plan: DirectProvisioningPlan): Record<string, string> {
  const repository = plan.repository;
  return {
    ...plan.agent.environmentVariables,
    ...(repository
      ? {
          REPO_URL: repository.url,
          REPO_NAME: repository.name,
          ...(repository.branch ? { REPO_BRANCH: repository.branch } : {}),
          ...(repository.checkoutRef ? { REPO_CHECKOUT_REF: repository.checkoutRef } : {}),
          ...(repository.baseCommit ? { REPO_BASE_COMMIT: repository.baseCommit } : {}),
          ...(repository.authToken ? { GITHUB_APP_TOKEN: repository.authToken } : {}),
        }
      : {}),
    AGENT_FILES_BASE64: base64(JSON.stringify(plan.agent.files)),
    ...(plan.setupCommands.length
      ? { WORKSPACE_SETUP_COMMAND_BASE64: base64(plan.setupCommands.join(" && ")) }
      : {}),
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function basicAuthHeader(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

export async function waitForDirectRuntime(
  runtime: DirectWorkspaceRuntime,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const ready = await fetch(runtime.url, {
      headers: {
        ...runtime.headers,
        ...(runtime.password ? { Authorization: basicAuthHeader(runtime.password) } : {}),
      },
      signal: controller.signal,
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => clearTimeout(timer));
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the OpenCode runtime");
}
