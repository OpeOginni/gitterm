import { and, db, eq, inArray } from "@gitterm/db";
import { modelProvider, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { getModelCredentialsService } from "../credentials/model-credentials";
import type { UserProviderCredential } from "./types";

/**
 * Fetch and decrypt every model credential the user has stored. Fetched once
 * per workspace creation and handed to the agent provisioner, so each agent
 * can map the same credentials into its own native format.
 */
export async function getUserProviderCredentials(
  userId: string,
  credentialIds?: string[],
): Promise<UserProviderCredential[]> {
  const credService = getModelCredentialsService();

  if (credentialIds?.length === 0) return [];

  const conditions = [
    eq(userModelCredential.userId, userId),
    eq(userModelCredential.isActive, true),
  ];
  if (credentialIds) conditions.push(inArray(userModelCredential.id, credentialIds));
  else conditions.push(eq(userModelCredential.isDefault, true));

  const userCredentials = await db
    .select()
    .from(userModelCredential)
    .where(and(...conditions))
    .leftJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id));

  if (credentialIds && userCredentials.length !== new Set(credentialIds).size) {
    throw new Error("One or more selected model credentials are unavailable");
  }

  const logicalProviders = new Set<string>();
  for (const row of userCredentials) {
    const logicalProviderKey = row.user_model_credential.logicalProviderKey;
    if (logicalProviders.has(logicalProviderKey)) {
      throw new Error(`Only one credential can be selected for ${logicalProviderKey}`);
    }
    logicalProviders.add(logicalProviderKey);
  }

  const entries = await Promise.all(
    userCredentials.map(async (cred) => {
      const providerName = cred.model_provider?.name;
      if (!providerName) return null;

      const credentialId = cred.user_model_credential.id;
      const decrypted = await credService.getCredential(credentialId, userId);
      if (!decrypted) return null;

      return {
        providerName: decrypted.providerName,
        credential: decrypted.credential,
      } satisfies UserProviderCredential;
    }),
  );

  return entries.filter((entry): entry is UserProviderCredential => entry !== null);
}
