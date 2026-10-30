import { and, db, eq, isNull } from "@gitterm/db";
import { userModelCredential } from "@gitterm/db/schema/model-credentials";
import { providerConfig } from "@gitterm/db/schema/provider-config";
import { workspace, workspaceEnvironmentVariables } from "@gitterm/db/schema/workspace";
import { workspaceRouteAccess } from "@gitterm/db/schema/workspace-route-access";
import { workspaceRuntimeBundle } from "@gitterm/db/schema/credential-security";
import { githubRepositoryConfig, googleIssuerConfig } from "@gitterm/db/schema/integrations";
import { mcpConnection } from "@gitterm/db/schema/mcp";
import { mcpAuthContext } from "../service/integrations/mcp";
import { encryptionContext, getEncryptionService } from "../service/encryption";
import { workspaceEnvironmentContext } from "../service/workspace-environment-secrets";
import { workspacePasswordContext } from "../utils/workspace-password";
import env from "@gitterm/env/server";

const apply = process.argv.includes("--apply");
const encryption = getEncryptionService();
let checked = 0;
let candidates = 0;
let updated = 0;
let conflicts = 0;

async function rewrapText(input: {
  value: string;
  context?: string;
  legacyContext?: string;
  recordBound?: boolean;
  update: (encrypted: string) => Promise<unknown[]>;
}) {
  // Validate all values, including current-key records, before retiring any key.
  const plaintext = input.recordBound
    ? encryption.decryptForRecord(input.value, input.context!, input.legacyContext)
    : encryption.decrypt(input.value, input.context);
  checked++;
  if (!encryption.needsRewrap(input.value, input.recordBound)) return;
  candidates++;
  if (!apply) return;
  if (input.value.startsWith("v3:") && env.ENCRYPTION_WRITE_VERSION !== "v3") {
    throw new Error("Cannot downgrade record-bound ciphertext during rotation");
  }
  const encrypted = input.recordBound
    ? encryption.encryptForRecord(plaintext, input.context!, input.legacyContext)
    : encryption.encrypt(plaintext, input.context);
  const verified = input.recordBound
    ? encryption.decryptForRecord(encrypted, input.context!, input.legacyContext)
    : encryption.decrypt(encrypted, input.context);
  if (verified !== plaintext) throw new Error("Encryption verification failed");
  // Every callback compares the old ciphertext, not just the record ID.
  if ((await input.update(encrypted)).length) updated++;
  else conflicts++;
}

try {
  for (const row of await db.select().from(userModelCredential).orderBy(userModelCredential.id)) {
    await rewrapText({
      value: row.encryptedCredential,
      recordBound: true,
      context: encryptionContext("model-credential", row.userId, row.id, row.providerId),
      update: (encryptedCredential) =>
        db
          .update(userModelCredential)
          .set({ encryptedCredential })
          .where(
            and(
              eq(userModelCredential.id, row.id),
              eq(userModelCredential.userId, row.userId),
              eq(userModelCredential.providerId, row.providerId),
              eq(userModelCredential.encryptedCredential, row.encryptedCredential),
            ),
          )
          .returning({ id: userModelCredential.id }),
    });
  }

  for (const row of await db.select().from(providerConfig)) {
    await rewrapText({
      value: row.encryptedCredentials,
      recordBound: true,
      context: encryptionContext("provider-config", row.id, row.providerTypeId),
      update: (encryptedCredentials) =>
        db
          .update(providerConfig)
          .set({ encryptedCredentials })
          .where(
            and(
              eq(providerConfig.id, row.id),
              eq(providerConfig.providerTypeId, row.providerTypeId),
              eq(providerConfig.encryptedCredentials, row.encryptedCredentials),
            ),
          )
          .returning({ id: providerConfig.id }),
    });
  }

  for (const row of await db.select().from(workspaceRouteAccess)) {
    await rewrapText({
      value: row.encryptedHeaders,
      recordBound: true,
      context: encryptionContext("workspace-route", row.workspaceId, String(row.port)),
      update: (encryptedHeaders) =>
        db
          .update(workspaceRouteAccess)
          .set({ encryptedHeaders })
          .where(
            and(
              eq(workspaceRouteAccess.id, row.id),
              eq(workspaceRouteAccess.encryptedHeaders, row.encryptedHeaders),
              eq(workspaceRouteAccess.workspaceId, row.workspaceId),
              row.port === null
                ? isNull(workspaceRouteAccess.port)
                : eq(workspaceRouteAccess.port, row.port),
            ),
          )
          .returning({ id: workspaceRouteAccess.id }),
    });
  }

  for (const row of await db.select().from(workspace)) {
    if (row.serverPassword)
      await rewrapText({
        value: row.serverPassword,
        recordBound: true,
        context: workspacePasswordContext(row),
        update: (serverPassword) =>
          db
            .update(workspace)
            .set({ serverPassword })
            .where(
              and(
                eq(workspace.id, row.id),
                eq(workspace.userId, row.userId),
                eq(workspace.serverPassword, row.serverPassword!),
              ),
            )
            .returning({ id: workspace.id }),
      });
    const connection = row.sshConnection;
    if (connection?.revocationToken)
      await rewrapText({
        value: connection.revocationToken,
        recordBound: true,
        context: encryptionContext("daytona-ssh", row.id),
        update: (revocationToken) =>
          db
            .update(workspace)
            .set({ sshConnection: { ...connection, revocationToken } })
            .where(and(eq(workspace.id, row.id), eq(workspace.sshConnection, connection)))
            .returning({ id: workspace.id }),
      });
  }

  for (const row of await db.select().from(workspaceRuntimeBundle)) {
    await rewrapText({
      value: row.encryptedPayload,
      context: `gitterm:workspace-runtime:${row.workspaceId}`,
      update: (encryptedPayload) =>
        db
          .update(workspaceRuntimeBundle)
          .set({ encryptedPayload })
          .where(
            and(
              eq(workspaceRuntimeBundle.workspaceId, row.workspaceId),
              eq(workspaceRuntimeBundle.encryptedPayload, row.encryptedPayload),
            ),
          )
          .returning({ id: workspaceRuntimeBundle.workspaceId }),
    });
  }

  for (const row of await db.select().from(workspaceEnvironmentVariables)) {
    const stored = row.environmentVariables as { version?: number; ciphertext?: string };
    if (stored?.version !== 1 || typeof stored.ciphertext !== "string") {
      throw new Error("Invalid encrypted workspace environment");
    }
    await rewrapText({
      value: stored.ciphertext,
      recordBound: true,
      context: workspaceEnvironmentContext(row),
      legacyContext: "gitterm:workspace-environment",
      update: (ciphertext) =>
        db
          .update(workspaceEnvironmentVariables)
          .set({ environmentVariables: { version: 1, ciphertext } })
          .where(
            and(
              eq(workspaceEnvironmentVariables.id, row.id),
              eq(workspaceEnvironmentVariables.userId, row.userId),
              eq(workspaceEnvironmentVariables.agentTypeId, row.agentTypeId),
              eq(workspaceEnvironmentVariables.environmentVariables, row.environmentVariables),
            ),
          )
          .returning({ id: workspaceEnvironmentVariables.id }),
    });
  }

  for (const row of await db.select().from(mcpConnection)) {
    await rewrapText({
      value: row.encryptedAuth,
      context: mcpAuthContext(row.id),
      update: (encryptedAuth) =>
        db
          .update(mcpConnection)
          .set({ encryptedAuth })
          .where(
            and(eq(mcpConnection.id, row.id), eq(mcpConnection.encryptedAuth, row.encryptedAuth)),
          )
          .returning({ id: mcpConnection.id }),
    });
  }

  for (const row of await db.select().from(googleIssuerConfig)) {
    await rewrapText({
      value: row.encryptedPrivateKey,
      context: "google:issuer:key",
      update: (encryptedPrivateKey) =>
        db
          .update(googleIssuerConfig)
          .set({ encryptedPrivateKey })
          .where(
            and(
              eq(googleIssuerConfig.id, row.id),
              eq(googleIssuerConfig.encryptedPrivateKey, row.encryptedPrivateKey),
            ),
          )
          .returning({ id: googleIssuerConfig.id }),
    });
  }

  for (const row of await db.select().from(githubRepositoryConfig)) {
    for (const [field, context] of [
      ["encryptedPrivateKey", "github:app:key"],
      ["encryptedWebhookSecret", "github:app:webhook"],
      ["encryptedPat", "github:global:pat"],
    ] as const) {
      const value = row[field];
      if (!value) continue;
      await rewrapText({
        value,
        context,
        update: (encrypted) =>
          db
            .update(githubRepositoryConfig)
            .set({ [field]: encrypted })
            .where(
              and(eq(githubRepositoryConfig.id, row.id), eq(githubRepositoryConfig[field], value)),
            )
            .returning({ id: githubRepositoryConfig.id }),
      });
    }
  }

  console.log(
    JSON.stringify({ mode: apply ? "apply" : "dry-run", checked, candidates, updated, conflicts }),
  );
  if (conflicts) {
    console.error("Records changed concurrently. Re-run until candidates and conflicts are zero.");
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Encryption migration failed. Check keyring, write version, and stored formats. No secret values were logged; completed updates are safe to rerun.",
  );
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
