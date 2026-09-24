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
  summary: string;
  description: string;
  logo: string;
  accent: string;
};

export const INTEGRATION_META: Record<IntegrationKey, IntegrationMeta> = {
  github: {
    summary: "Repository access via a GitHub App or a shared PAT.",
    description:
      "Choose one repository access mode: a shared admin PAT or an App that users install. GitHub login is independent of repository access.",
    logo: "/github.svg",
    accent: "bg-foreground/[0.06]",
  },
  google: {
    summary: "Workload identity for users’ Google Cloud service accounts.",
    description:
      "GitTerm signs short-lived identity assertions; users attach their own service accounts. No Google private key is stored.",
    logo: "/google-cloud.svg",
    accent: "bg-sky-500/[0.08]",
  },
  gitlab: {
    summary: "GitLab repository access.",
    description:
      "The connector is not implemented yet. Configuration will appear here when it is ready.",
    logo: "/gitlab.svg",
    accent: "bg-orange-500/[0.08]",
  },
  bitbucket: {
    summary: "Bitbucket repository access.",
    description:
      "The connector is not implemented yet. Configuration will appear here when it is ready.",
    logo: "/bitbucket.svg",
    accent: "bg-blue-500/[0.08]",
  },
  executor: {
    summary: "Dedicated per-user execution connection.",
    description:
      "A future dedicated connection flow for each user, with optional admin-shared access.",
    logo: "/executor.png",
    accent: "bg-violet-500/[0.08]",
  },
  mcp: {
    summary: "Bring your own MCP servers.",
    description:
      "The connector is not implemented yet. Configuration will appear here when it is ready.",
    logo: "/mcp.svg",
    accent: "bg-foreground/[0.06]",
  },
};

export function isIntegrationKey(value: string): value is IntegrationKey {
  return (INTEGRATION_KEYS as string[]).includes(value);
}
