import { and, db, eq, inArray } from "@gitterm/db";
import { userModelCredential } from "@gitterm/db/schema/model-credentials";
import { getRunWorkspace } from "./agent-run/target";

/** Configuration discovery only: never decrypts credentials or wakes the runtime. */
export async function getWorkspaceModelAccess(workspaceId: string, userId: string) {
  const workspace = await getRunWorkspace(workspaceId, userId);
  const saved = workspace.modelCredentialIds.length
    ? await db
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
    : [];
  const providers = [
    ...saved.map((credential) => ({ ...credential, source: "saved" as const })),
    ...workspace.inlineModelProviders.map((provider) => ({
      provider,
      label: null,
      active: true,
      source: "apiKey" as const,
    })),
  ];
  return { providers };
}
