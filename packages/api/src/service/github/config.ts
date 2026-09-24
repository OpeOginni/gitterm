import { db, eq } from "@gitterm/db";
import { githubAppConfig } from "@gitterm/db/schema/integrations";
import env from "@gitterm/env/server";
import { EncryptionService } from "../encryption";

export async function githubRepositoryAppConfig() {
  const [stored] = await db.select().from(githubAppConfig).where(eq(githubAppConfig.id, "github"));
  if (stored) {
    const encryption = new EncryptionService();
    return {
      appId: stored.appId,
      slug: stored.slug,
      privateKey: encryption.decrypt(stored.encryptedPrivateKey, "github:app:key"),
      webhookSecret: encryption.decrypt(stored.encryptedWebhookSecret, "github:app:webhook"),
      source: "database" as const,
    };
  }
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
  return {
    appId: env.GITHUB_APP_ID,
    slug: "",
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    source: "environment" as const,
  };
}

export async function githubWebhookSecret(): Promise<string> {
  const [stored] = await db
    .select({ secret: githubAppConfig.encryptedWebhookSecret })
    .from(githubAppConfig)
    .where(eq(githubAppConfig.id, "github"));
  return stored
    ? new EncryptionService().decrypt(stored.secret, "github:app:webhook")
    : env.GITHUB_WEBHOOK_SECRET;
}
