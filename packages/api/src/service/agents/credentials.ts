import { db, eq } from "@gitterm/db";
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
): Promise<UserProviderCredential[]> {
  const credService = getModelCredentialsService();

  const userCredentials = await db
    .select()
    .from(userModelCredential)
    .where(eq(userModelCredential.userId, userId))
    .leftJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id));

  const entries = await Promise.all(
    userCredentials.map(async (cred) => {
      const providerName = cred.model_provider?.name;
      if (!providerName) return null;

      const decrypted = await credService.getUserCredentialForProvider(userId, providerName);
      if (!decrypted) return null;

      return {
        providerName: decrypted.providerName,
        credential: decrypted.credential,
      } satisfies UserProviderCredential;
    }),
  );

  return entries.filter((entry): entry is UserProviderCredential => entry !== null);
}
