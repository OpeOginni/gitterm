import { and, db, eq, inArray } from "@gitterm/db";
import { model, modelProvider, userModelCredential } from "@gitterm/db/schema/model-credentials";
import { getRunWorkspace } from "./agent-run/target";

/** Configuration discovery only: never decrypts credentials or wakes the runtime. */
export async function getWorkspaceModelAccess(workspaceId: string, userId: string) {
  const workspace = await getRunWorkspace(workspaceId, userId);
  const [saved, catalog] = await Promise.all([
    workspace.modelCredentialIds.length
      ? db
          .select({
            provider: userModelCredential.logicalProviderKey,
            label: userModelCredential.label,
            active: userModelCredential.isActive,
          })
          .from(userModelCredential)
          .where(
            and(
              eq(userModelCredential.userId, userId),
              inArray(userModelCredential.id, workspace.modelCredentialIds),
            ),
          )
      : Promise.resolve([]),
    db
      .select({
        id: model.modelId,
        name: model.displayName,
        provider: modelProvider.logicalProviderKey,
        isFree: model.isFree,
        isRecommended: model.isRecommended,
      })
      .from(model)
      .innerJoin(modelProvider, eq(model.providerId, modelProvider.id))
      .where(and(eq(model.isEnabled, true), eq(modelProvider.isEnabled, true))),
  ]);
  const providers = [
    ...saved.map((credential) => ({ ...credential, source: "saved" as const })),
    ...workspace.inlineModelProviders.map((provider) => ({
      provider,
      label: null,
      active: true,
      source: "apiKey" as const,
    })),
  ];
  const available = new Set(
    providers.filter((provider) => provider.active).map((provider) => provider.provider),
  );
  return {
    providers,
    models: catalog.filter((entry) => entry.isFree || available.has(entry.provider)),
  };
}
