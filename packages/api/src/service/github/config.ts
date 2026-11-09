import { db, eq } from "@gitterm/db";
import { githubRepositoryConfig } from "@gitterm/db/schema/integrations";
import { EncryptionService } from "../encryption";

async function storedGithubConfig() {
  const [stored] = await db
    .select()
    .from(githubRepositoryConfig)
    .where(eq(githubRepositoryConfig.id, "github"));
  return stored ?? null;
}

export async function githubRepositoryMode() {
  const stored = await storedGithubConfig();
  if (stored?.mode === "pat") {
    return {
      mode: "pat" as const,
      accountLogin: stored.accountLogin!,
      patSuffix: stored.patSuffix!,
      source: "database" as const,
    };
  }
  if (stored?.mode === "app") {
    return {
      mode: "app" as const,
      appId: stored.appId!,
      slug: stored.slug!,
      source: "database" as const,
    };
  }
  return null;
}

export async function githubRepositoryAppConfig() {
  const stored = await storedGithubConfig();
  if (stored?.mode === "pat") return null;
  if (stored?.mode === "app") {
    const encryption = new EncryptionService();
    return {
      appId: stored.appId!,
      slug: stored.slug!,
      privateKey: encryption.decrypt(stored.encryptedPrivateKey!, "github:app:key"),
      webhookSecret: encryption.decrypt(stored.encryptedWebhookSecret!, "github:app:webhook"),
      source: "database" as const,
    };
  }
  return null;
}

export async function githubGlobalPat() {
  const stored = await storedGithubConfig();
  if (stored?.mode !== "pat" || !stored.encryptedPat) return null;
  return new EncryptionService().decrypt(stored.encryptedPat, "github:global:pat");
}

export async function githubWebhookSecret(): Promise<string> {
  const stored = await storedGithubConfig();
  if (stored?.mode === "pat") return "";
  return stored?.encryptedWebhookSecret
    ? new EncryptionService().decrypt(stored.encryptedWebhookSecret, "github:app:webhook")
    : "";
}
