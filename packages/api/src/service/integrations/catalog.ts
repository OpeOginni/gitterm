import { db, eq } from "@gitterm/db";
import { integrationSettings } from "@gitterm/db/schema/integrations";

export const INTEGRATIONS = {
  github: { name: "GitHub", category: "git", ready: true },
  google: { name: "Google Cloud", category: "cloud", ready: true },
  gitlab: { name: "GitLab", category: "git", ready: false },
  bitbucket: { name: "Bitbucket", category: "git", ready: false },
  executor: { name: "Executor", category: "mcp", ready: false },
  mcp: { name: "Other MCP servers", category: "mcp", ready: false },
} as const;

export type IntegrationKey = keyof typeof INTEGRATIONS;

export async function integrationPolicy(key: IntegrationKey) {
  const [settings] = await db
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.key, key));
  return {
    key,
    ...INTEGRATIONS[key],
    enabled: INTEGRATIONS[key].ready && (settings?.enabled ?? false),
    allowPersonal: settings?.allowPersonal ?? true,
    allowShared: settings?.allowShared ?? false,
  };
}

export async function integrationCatalog() {
  return Promise.all((Object.keys(INTEGRATIONS) as IntegrationKey[]).map(integrationPolicy));
}
