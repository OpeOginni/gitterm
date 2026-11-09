export type IntegrationKey = "github" | "google" | "gitlab" | "bitbucket" | "executor" | "mcp";

export const INTEGRATION_KEYS: IntegrationKey[] = [
  "github",
  "google",
  "gitlab",
  "bitbucket",
  "executor",
  "mcp",
];

export type IntegrationMeta = {
  /** Same as the server's catalog, so pages can title themselves before data loads. */
  name: string;
  summary: string;
  description: string;
  logo: string;
};

export const INTEGRATION_META: Record<IntegrationKey, IntegrationMeta> = {
  github: {
    name: "GitHub",
    summary: "Repository access via a GitHub App or a shared PAT.",
    description:
      "Choose one repository access mode: a shared admin PAT or an App that users install. GitHub login is independent of repository access.",
    logo: "/github.svg",
  },
  google: {
    name: "Google Cloud",
    summary: "Workload identity for users’ Google Cloud service accounts.",
    description:
      "GitTerm signs short-lived identity assertions; users attach their own service accounts. No Google private key is stored.",
    logo: "/google-cloud.svg",
  },
  gitlab: {
    name: "GitLab",
    summary: "GitLab repository access.",
    description:
      "The connector is not implemented yet. Configuration will appear here when it is ready.",
    logo: "/gitlab.svg",
  },
  bitbucket: {
    name: "Bitbucket",
    summary: "Bitbucket repository access.",
    description:
      "The connector is not implemented yet. Configuration will appear here when it is ready.",
    logo: "/bitbucket.svg",
  },
  executor: {
    name: "Executor",
    summary: "Connect a user's Executor tool catalog over MCP.",
    description:
      "Users connect an Executor organization endpoint and PAT through the same setup as custom MCP servers. OpenCode connects directly. Credentials are encrypted at rest but accessible to attached workspace agents. Personal connections only.",
    logo: "/executor.png",
  },
  mcp: {
    name: "MCP servers",
    summary: "Bring your own MCP servers.",
    description:
      "Users add public HTTPS Streamable HTTP servers with no auth or encrypted authentication headers and attach connections to OpenCode workspaces. No GitTerm relay or managed OAuth. Workspace agents can read credentials. Personal connections only.",
    logo: "/mcp.svg",
  },
};

export function isIntegrationKey(value: string): value is IntegrationKey {
  return (INTEGRATION_KEYS as string[]).includes(value);
}
