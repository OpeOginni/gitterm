import { and, db, eq, inArray } from "@gitterm/db";
import { workspaceRuntimeBundle } from "@gitterm/db/schema/credential-security";
import { workspace } from "@gitterm/db/schema/workspace";
import { getEncryptionService } from "./encryption";

const aad = (workspaceId: string) => `gitterm:workspace-runtime:${workspaceId}`;

export async function storeWorkspaceRuntimeBundle(
  workspaceId: string,
  environment: Record<string, string | undefined>,
): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const encryptedPayload = getEncryptionService().encrypt(
    JSON.stringify(payload),
    aad(workspaceId),
  );
  await db
    .insert(workspaceRuntimeBundle)
    .values({ workspaceId, encryptedPayload })
    .onConflictDoUpdate({
      target: workspaceRuntimeBundle.workspaceId,
      set: { encryptedPayload, updatedAt: new Date() },
    });
}

export async function readWorkspaceRuntimeBundle(input: {
  workspaceId: string;
  userId: string;
}): Promise<Record<string, string>> {
  const [record] = await db
    .select({ encryptedPayload: workspaceRuntimeBundle.encryptedPayload })
    .from(workspaceRuntimeBundle)
    .innerJoin(workspace, eq(workspaceRuntimeBundle.workspaceId, workspace.id))
    .where(
      and(
        eq(workspace.id, input.workspaceId),
        eq(workspace.userId, input.userId),
        inArray(workspace.status, ["pending", "running"]),
      ),
    );
  if (!record) throw new Error("Runtime bundle unavailable");
  const parsed = JSON.parse(
    getEncryptionService().decrypt(record.encryptedPayload, aad(input.workspaceId)),
  ) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid runtime bundle");
  }
  const entries = Object.entries(parsed);
  if (
    !entries.every(
      ([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string",
    )
  ) {
    throw new Error("Invalid runtime bundle");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function railwayBootstrapEnvironment(environment: Record<string, string | undefined>) {
  return {
    GITTERM_REMOTE_BOOTSTRAP: "1",
    WORKSPACE_ID: environment.WORKSPACE_ID,
    WORKSPACE_API_URL: environment.WORKSPACE_API_URL,
    WORKSPACE_AGENT_AUTH_TOKEN: environment.WORKSPACE_AGENT_AUTH_TOKEN,
    WORKSPACE_PROVIDER: environment.WORKSPACE_PROVIDER,
  };
}
