import { and, db, eq, inArray } from "@gitterm/db";
import { modelProvider, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { TRPCError } from "@trpc/server";
import { getEncryptionService } from "../encryption";
import type { UserProviderCredential } from "./types";

/**
 * One entry of `modelCredentials` on workspace create. Each entry picks the
 * credential for a single provider:
 *
 * - `{ providerName, apiKey }` — inline key, injected into the workspace only
 *   and never persisted. OAuth providers require the dashboard flow.
 * - `{ providerName, label }` — the dashboard credential with that label.
 * - `{ providerName }` — the dashboard default credential for that provider.
 */
export interface WorkspaceModelCredentialInput {
  providerName: string;
  apiKey?: string;
  label?: string;
}

type StoredCredentialRow = {
  user_model_credential: typeof userModelCredential.$inferSelect;
  model_provider: typeof modelProvider.$inferSelect;
};

function credentialError(code: string, detail: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: `${code}: ${detail}` });
}

function assertUniqueLogicalProvider(seen: Set<string>, logicalProviderKey: string, verb: string) {
  if (seen.has(logicalProviderKey)) {
    throw credentialError(
      "MODEL_CREDENTIAL_DUPLICATE_PROVIDER",
      `Only one credential can be ${verb} for ${logicalProviderKey}`,
    );
  }
  seen.add(logicalProviderKey);
}

function toProviderCredential(row: StoredCredentialRow): UserProviderCredential {
  return {
    credentialId: row.user_model_credential.id,
    providerName: row.model_provider.name,
    logicalProviderKey: row.user_model_credential.logicalProviderKey,
    credential: getEncryptionService().decryptCredential(
      row.user_model_credential.encryptedCredential,
    ),
  };
}

/** Fetch and decrypt the user's default credential for every provider. */
export async function getUserProviderCredentials(
  userId: string,
): Promise<UserProviderCredential[]> {
  const rows = await db
    .select()
    .from(userModelCredential)
    .where(
      and(
        eq(userModelCredential.userId, userId),
        eq(userModelCredential.isActive, true),
        eq(userModelCredential.isDefault, true),
      ),
    )
    .innerJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id));

  return rows.map(toProviderCredential);
}

/**
 * Resolve dashboard credentials selected by provider name plus optional label.
 * Without a label the provider's default credential is used. Errors list the
 * labels that exist so callers can correct the selection without a list call.
 */
async function getUserProviderCredentialsByLabel(
  userId: string,
  selectors: WorkspaceModelCredentialInput[],
): Promise<UserProviderCredential[]> {
  if (selectors.length === 0) return [];

  const providerNames = [...new Set(selectors.map((selector) => selector.providerName))];
  const [providers, rows] = await Promise.all([
    db
      .select()
      .from(modelProvider)
      .where(and(inArray(modelProvider.name, providerNames), eq(modelProvider.isEnabled, true))),
    db
      .select()
      .from(userModelCredential)
      .innerJoin(modelProvider, eq(userModelCredential.providerId, modelProvider.id))
      .where(
        and(
          eq(userModelCredential.userId, userId),
          eq(userModelCredential.isActive, true),
          inArray(modelProvider.name, providerNames),
        ),
      ),
  ]);
  const providersByName = new Map(providers.map((provider) => [provider.name, provider]));

  const logicalProviders = new Set<string>();
  return selectors.map((selector) => {
    const provider = providersByName.get(selector.providerName);
    if (!provider) {
      throw credentialError(
        "MODEL_CREDENTIAL_INVALID",
        `Unknown or disabled provider "${selector.providerName}". Use credentials.listProviders() for valid names`,
      );
    }
    assertUniqueLogicalProvider(logicalProviders, provider.logicalProviderKey, "selected");

    const candidates = rows.filter((row) => row.model_provider.name === provider.name);
    if (candidates.length === 0) {
      throw credentialError(
        "MODEL_CREDENTIAL_UNAVAILABLE",
        `No ${provider.name} credential is connected to this account. Add one in the dashboard or pass an inline apiKey`,
      );
    }

    const labels = candidates.map((row) => row.user_model_credential.label);
    const match = selector.label
      ? candidates.find((row) => row.user_model_credential.label === selector.label)
      : (candidates.find((row) => row.user_model_credential.isDefault) ?? candidates[0]);
    if (!match) {
      throw credentialError(
        "MODEL_CREDENTIAL_UNAVAILABLE",
        `No ${provider.name} credential labelled "${selector.label}". Available labels: ${labels.map((label) => `"${label}"`).join(", ")}`,
      );
    }
    return toProviderCredential(match);
  });
}

/**
 * Validate inline credentials against the provider registry and convert them
 * to the shape provisioners consume. Nothing here touches storage.
 */
async function resolveInlineProviderCredentials(
  inlineCredentials: Array<WorkspaceModelCredentialInput & { apiKey: string }>,
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
    assertUniqueLogicalProvider(logicalProviders, provider.logicalProviderKey, "supplied");

    return {
      credentialId: null,
      providerName: provider.name,
      logicalProviderKey: provider.logicalProviderKey,
      credential: { type: "api_key", apiKey: input.apiKey },
    } satisfies UserProviderCredential;
  });
}

/**
 * Resolve the full credential set for a new workspace.
 *
 * - Inline entries (`apiKey`) are injected as-is and always override the
 *   dashboard credential for the same logical provider.
 * - Dashboard selections (entries without `apiKey`) are resolved exactly;
 *   naming any dashboard credential disables the implicit "all defaults".
 * - With no dashboard selection at all, the user's default credentials are
 *   injected for every provider not covered inline.
 */
export async function resolveWorkspaceProviderCredentials(options: {
  userId: string;
  modelCredentials?: WorkspaceModelCredentialInput[];
}): Promise<UserProviderCredential[]> {
  const entries = options.modelCredentials ?? [];
  const inlineEntries = entries.filter(
    (entry): entry is WorkspaceModelCredentialInput & { apiKey: string } =>
      entry.apiKey !== undefined,
  );
  const selectorEntries = entries.filter((entry) => entry.apiKey === undefined);

  const [inline, stored] = await Promise.all([
    resolveInlineProviderCredentials(inlineEntries),
    selectorEntries.length > 0
      ? getUserProviderCredentialsByLabel(options.userId, selectorEntries)
      : getUserProviderCredentials(options.userId),
  ]);

  const inlineProviders = new Set(inline.map((credential) => credential.logicalProviderKey));
  const clash =
    selectorEntries.length > 0
      ? stored.find((credential) => inlineProviders.has(credential.logicalProviderKey))
      : undefined;
  if (clash) {
    throw credentialError(
      "MODEL_CREDENTIAL_DUPLICATE_PROVIDER",
      `Only one credential can be selected for ${clash.logicalProviderKey}`,
    );
  }
  return [
    ...inline,
    ...stored.filter((credential) => !inlineProviders.has(credential.logicalProviderKey)),
  ];
}
