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
export const DIRECT_OPENCODE_SERVER_IMAGE = "opeoginni/gitterm-opencode-server:latest";
export const DIRECT_E2B_TEMPLATES = {
  standard: "gitterm-opencode-server",
  large: "gitterm-opencode-server-lg",
} as const;

export function resolveDirectImage(image?: string): string {
  return image?.trim() || DIRECT_OPENCODE_SERVER_IMAGE;
}

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
  if (!input.repo) {
    const repositoryOnly = [
      input.branch ? "branch" : undefined,
      input.checkoutRef ? "checkoutRef" : undefined,
      input.baseCommit ? "baseCommit" : undefined,
      input.repositoryCredentials ? "repositoryCredentials" : undefined,
    ].filter(Boolean);
    if (repositoryOnly.length) {
      throw new Error(`${repositoryOnly.join(", ")} require repo`);
    }
  }
  const credentials = new Map<string, ReturnType<typeof directModelAuth>>();
  for (const credential of input.modelCredentials ?? []) {
    const providerName = credential.providerName.trim();
    if (!providerName) throw new Error("Model credential providerName is required");
    if (credentials.has(providerName)) {
      throw new Error(`Duplicate model credential: ${providerName}`);
    }
    credentials.set(providerName, directModelAuth(credential));
  }
  const configuredPlugins = Array.isArray(input.opencode?.config?.plugin)
    ? input.opencode.config.plugin.filter((plugin): plugin is string => typeof plugin === "string")
    : [];
  const plugins = [...new Set([...configuredPlugins, ...(input.opencode?.plugins ?? [])])];
  const environmentVariables = { ...input.environmentVariables };
  delete environmentVariables.OPENCODE_SERVER_USERNAME;
  delete environmentVariables.GITTERM_DIRECT_PROVIDER;
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
        ...environmentVariables,
        OPENCODE_SERVER_PASSWORD: input.password,
      },
      command: DIRECT_OPENCODE_COMMAND,
      port: DIRECT_OPENCODE_PORT,
    },
    setupCommands: input.setupCommands ?? [],
  };
}

export function railwayContainerEnvironment(plan: DirectProvisioningPlan): Record<string, string> {
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
          ...(repository.authToken
            ? {
                GITTERM_GIT_USERNAME: repository.authUsername ?? "x-access-token",
                GITTERM_GIT_TOKEN: repository.authToken,
              }
            : {}),
        }
      : {}),
    AGENT_FILES_BASE64: base64(JSON.stringify(plan.agent.files)),
    ...(plan.setupCommands.length
      ? { WORKSPACE_SETUP_COMMAND_BASE64: base64(setupCommandScript(plan.setupCommands)) }
      : {}),
    GITTERM_DIRECT_PROVIDER: "railway",
  };
}

export function setupCommandScript(commands: string[]): string {
  return ["set -eu", ...commands].join("\n");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function cloneRepositoryScript(
  repository: NonNullable<DirectProvisioningPlan["repository"]>,
  directory: string,
): string {
  const ref = repository.checkoutRef ?? repository.branch;
  const commands = [
    `mkdir -p ${shellQuote(directory)}`,
    ...(repository.authToken
      ? [
          "mkdir -p /tmp/gitterm",
          `printf %s ${shellQuote(repository.authToken)} > /tmp/gitterm/git-token`,
          `printf %s ${shellQuote(repository.authUsername ?? "x-access-token")} > /tmp/gitterm/git-username`,
          "chmod 600 /tmp/gitterm/git-token /tmp/gitterm/git-username",
          `git config --global credential.helper ${shellQuote('!f() { [ "$1" = get ] || exit 0; printf "%s\\n" "username=$(cat /tmp/gitterm/git-username)" "password=$(cat /tmp/gitterm/git-token)"; }; f')}`,
        ]
      : []),
    `GIT_TERMINAL_PROMPT=0 git clone ${ref ? `--branch ${shellQuote(ref)} ` : ""}${shellQuote(repository.url)} ${shellQuote(directory)}`,
    ...(repository.baseCommit
      ? [
          `GIT_TERMINAL_PROMPT=0 git -C ${shellQuote(directory)} fetch --depth 1 origin ${shellQuote(repository.baseCommit)}`,
          `git -C ${shellQuote(directory)} checkout --detach ${shellQuote(repository.baseCommit)}`,
        ]
      : []),
    ...(repository.authToken
      ? ["git config --global --unset-all credential.helper || true", "rm -rf /tmp/gitterm"]
      : []),
  ];
  return setupCommandScript(commands);
}

export async function pinFloatingDockerImage(image: string): Promise<string> {
  if (image.includes("@sha256:")) return image;
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  const name = colon > slash ? image.slice(0, colon) : image;
  const tag = colon > slash ? image.slice(colon + 1) : "latest";
  if (!["latest", "lts", "stable"].includes(tag.toLowerCase())) return image;
  if (name.includes("/") && name.split("/").length !== 2) return image;
  const response = await fetch(
    `https://hub.docker.com/v2/repositories/${name}/tags/${encodeURIComponent(tag)}`,
  );
  if (!response.ok) {
    throw new Error(`Could not resolve a digest for Docker image ${image} (${response.status})`);
  }
  const body = (await response.json()) as {
    digest?: string;
    images?: Array<{ digest?: string }>;
  };
  const digest = body.digest || body.images?.find((entry) => entry.digest)?.digest;
  if (!digest?.startsWith("sha256:")) {
    throw new Error(`Docker Hub did not return a digest for ${image}`);
  }
  return `${name}@${digest}`;
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
