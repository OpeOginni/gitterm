import { db, eq } from "@gitterm/db";
import { userModelCredential } from "@gitterm/db/schema/model-credentials";
import { providerConfig } from "@gitterm/db/schema/provider-config";
import { workspace, workspaceEnvironmentVariables } from "@gitterm/db/schema/workspace";
import { workspaceRouteAccess } from "@gitterm/db/schema/workspace-route-access";
import { workspaceRuntimeBundle } from "@gitterm/db/schema/credential-security";
import { getEncryptionService } from "../service/encryption";

const apply = process.argv.includes("--apply");
const encryption = getEncryptionService();
let candidates = 0;

async function rewrapText(input: {
  value: string;
  context?: string;
  update: (encrypted: string) => Promise<unknown>;
}) {
  if (!encryption.needsRewrap(input.value)) return;
  const plaintext = encryption.decrypt(input.value, input.context);
  candidates++;
  if (apply) await input.update(encryption.encrypt(plaintext, input.context));
}

for (const row of await db.select().from(userModelCredential)) {
  await rewrapText({
    value: row.encryptedCredential,
    update: (encryptedCredential) =>
      db
        .update(userModelCredential)
        .set({ encryptedCredential, updatedAt: new Date() })
        .where(eq(userModelCredential.id, row.id)),
  });
}

for (const row of await db.select().from(providerConfig)) {
  await rewrapText({
    value: row.encryptedCredentials,
    update: (encryptedCredentials) =>
      db
        .update(providerConfig)
        .set({ encryptedCredentials, updatedAt: new Date() })
        .where(eq(providerConfig.id, row.id)),
  });
}

for (const row of await db.select().from(workspaceRouteAccess)) {
  await rewrapText({
    value: row.encryptedHeaders,
    update: (encryptedHeaders) =>
      db
        .update(workspaceRouteAccess)
        .set({ encryptedHeaders, updatedAt: new Date() })
        .where(eq(workspaceRouteAccess.id, row.id)),
  });
}

for (const row of await db
  .select({ id: workspace.id, serverPassword: workspace.serverPassword })
  .from(workspace)) {
  if (!row.serverPassword) continue;
  await rewrapText({
    value: row.serverPassword,
    update: (serverPassword) =>
      db
        .update(workspace)
        .set({ serverPassword, updatedAt: new Date() })
        .where(eq(workspace.id, row.id)),
  });
}

for (const row of await db.select().from(workspaceRuntimeBundle)) {
  const context = `gitterm:workspace-runtime:${row.workspaceId}`;
  await rewrapText({
    value: row.encryptedPayload,
    context,
    update: (encryptedPayload) =>
      db
        .update(workspaceRuntimeBundle)
        .set({ encryptedPayload, updatedAt: new Date() })
        .where(eq(workspaceRuntimeBundle.workspaceId, row.workspaceId)),
  });
}

for (const row of await db.select().from(workspaceEnvironmentVariables)) {
  const stored = row.environmentVariables as { version?: number; ciphertext?: string };
  if (stored.version !== 1 || typeof stored.ciphertext !== "string") continue;
  await rewrapText({
    value: stored.ciphertext,
    context: "gitterm:workspace-environment",
    update: (ciphertext) =>
      db
        .update(workspaceEnvironmentVariables)
        .set({ environmentVariables: { version: 1, ciphertext }, updatedAt: new Date() })
        .where(eq(workspaceEnvironmentVariables.id, row.id)),
  });
}

console.log(
  apply
    ? `Rewrapped ${candidates} encrypted records.`
    : `Dry run: ${candidates} encrypted records require rewrapping. Re-run with --apply.`,
);
