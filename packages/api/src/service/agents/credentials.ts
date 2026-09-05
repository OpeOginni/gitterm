import { and, db, eq } from "@gitterm/db";
import { modelProvider, userModelCredential } from "@gitterm/db/schema/model-credentials";
import type { WorkspaceModelsInput } from "@gitterm/schema/workspace-models";
import { TRPCError } from "@trpc/server";
import { getEncryptionService } from "../encryption";
import type { UserProviderCredential } from "./types";
import { selectWorkspaceCredentials } from "./credential-selection";

export async function getUserProviderCredentials(
  userId: string,
): Promise<UserProviderCredential[]> {
  return resolveWorkspaceProviderCredentials({ userId });
}

/** Resolve sources first, decrypt only selected credentials, never persist inline keys. */
export async function resolveWorkspaceProviderCredentials(options: {
  userId: string;
  models?: WorkspaceModelsInput;
}): Promise<UserProviderCredential[]> {
  const [providers, rows] = await Promise.all([
    db.select().from(modelProvider).where(eq(modelProvider.isEnabled, true)),
    db
      .select()
      .from(userModelCredential)
      .innerJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id))
      .where(
        and(
          eq(userModelCredential.userId, options.userId),
          eq(userModelCredential.isActive, true),
          eq(modelProvider.isEnabled, true),
        ),
      ),
  ]);
  try {
    const selected = selectWorkspaceCredentials(
      options.models,
      providers,
      rows.map((row) => ({
        ...row.user_model_credential,
        providerName: row.model_provider.name,
      })),
    );
    return selected.map(
      (selection): UserProviderCredential =>
        selection.source === "apiKey"
          ? {
              credentialId: null,
              providerName: selection.provider.name,
              logicalProviderKey: selection.provider.logicalProviderKey,
              credential: { type: "api_key", apiKey: selection.apiKey },
            }
          : {
              credentialId: selection.credential.id,
              providerName: selection.credential.providerName,
              logicalProviderKey: selection.credential.logicalProviderKey,
              credential: getEncryptionService().decryptCredential(
                selection.credential.encryptedCredential,
              ),
            },
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MODEL_CREDENTIAL_")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}
