import { and, db, eq, inArray } from "@gitterm/db";
import { modelProvider, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { TRPCError } from "@trpc/server";
import { getEncryptionService } from "../encryption";
import type { UserProviderCredential } from "./types";

/**
 * An API key supplied directly in the workspace create call. Injected into
 * the provisioned workspace only — never persisted to the dashboard. OAuth
 * providers require the dashboard flow (device-code + refresh handling).
 */
export interface InlineProviderCredentialInput {
  providerName: string;
  apiKey: string;
}

function credentialError(code: string, detail: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: `${code}: ${detail}` });
}

/**
 * Fetch and decrypt the user's stored model credentials. When `credentialIds`
 * is provided every selected credential must resolve; otherwise the user's
 * default credentials are used.
 */
export async function getUserProviderCredentials(
  userId: string,
  credentialIds?: string[],
): Promise<UserProviderCredential[]> {
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
    .innerJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id));

  if (credentialIds && userCredentials.length !== new Set(credentialIds).size) {
    throw credentialError(
      "MODEL_CREDENTIAL_UNAVAILABLE",
      "One or more selected credentials are missing, inactive, or unavailable to this account",
    );
  }

  const logicalProviders = new Set<string>();
  for (const row of userCredentials) {
    const logicalProviderKey = row.user_model_credential.logicalProviderKey;
    if (logicalProviders.has(logicalProviderKey)) {
      throw credentialError(
        "MODEL_CREDENTIAL_DUPLICATE_PROVIDER",
        `Only one credential can be selected for ${logicalProviderKey}`,
      );
    }
    logicalProviders.add(logicalProviderKey);
  }

  const encryption = getEncryptionService();
  return userCredentials.map((row) => ({
    credentialId: row.user_model_credential.id,
    providerName: row.model_provider.name,
    logicalProviderKey: row.user_model_credential.logicalProviderKey,
    credential: encryption.decryptCredential(row.user_model_credential.encryptedCredential),
  }));
}

/**
 * Validate inline credentials against the provider registry and convert them
 * to the shape provisioners consume. Nothing here touches storage.
 */
async function resolveInlineProviderCredentials(
  inlineCredentials: InlineProviderCredentialInput[],
): Promise<UserProviderCredential[]> {
  if (inlineCredentials.length === 0) return [];

  const providerNames = [...new Set(inlineCredentials.map((input) => input.providerName))];
  const providers = await db
    .select()
    .from(modelProvider)
    .where(and(inArray(modelProvider.name, providerNames), eq(modelProvider.isEnabled, true)));
  const providersByName = new Map(providers.map((provider) => [provider.name, provider]));

  const logicalProviders = new Set<string>();
  return inlineCredentials.map((input) => {
    const provider = providersByName.get(input.providerName);
    if (!provider) {
      throw credentialError(
        "MODEL_CREDENTIAL_INVALID",
        `Unknown or disabled provider "${input.providerName}". Use credentials.listProviders() for valid names`,
      );
    }
    if (provider.authType !== "api_key") {
      throw credentialError(
        "MODEL_CREDENTIAL_INVALID",
        `Provider ${provider.name} uses ${provider.authType}; inline credentials only support API keys. Connect it in the dashboard instead`,
      );
    }
    if (logicalProviders.has(provider.logicalProviderKey)) {
      throw credentialError(
        "MODEL_CREDENTIAL_DUPLICATE_PROVIDER",
        `Only one credential can be supplied for ${provider.logicalProviderKey}`,
      );
    }
    logicalProviders.add(provider.logicalProviderKey);

    return {
      credentialId: null,
      providerName: provider.name,
      logicalProviderKey: provider.logicalProviderKey,
      credential: { type: "api_key", apiKey: input.apiKey },
    } satisfies UserProviderCredential;
  });
}

/**
 * Resolve the full credential set for a new workspace: inline credentials from
 * the request plus stored dashboard credentials. An inline credential always
 * overrides the dashboard credential for the same logical provider.
 */
export async function resolveWorkspaceProviderCredentials(options: {
  userId: string;
  credentialIds?: string[];
  inlineCredentials?: InlineProviderCredentialInput[];
}): Promise<UserProviderCredential[]> {
  const [inline, stored] = await Promise.all([
    resolveInlineProviderCredentials(options.inlineCredentials ?? []),
    getUserProviderCredentials(options.userId, options.credentialIds),
  ]);

  const inlineProviders = new Set(inline.map((credential) => credential.logicalProviderKey));
  return [
    ...inline,
    ...stored.filter((credential) => !inlineProviders.has(credential.logicalProviderKey)),
  ];
}
