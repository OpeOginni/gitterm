import { db } from "@gitterm/db";
import { workspaceCredentialAudit } from "@gitterm/db/schema/credential-security";

export async function recordCredentialAudit(input: {
  workspaceId: string;
  userId: string;
  credentialKind: "github" | "google" | "runtime_bundle" | "model";
  integrationId?: string | null;
  action: "issued" | "read";
  expiresAt?: string;
  metadata?: Record<string, string>;
}): Promise<void> {
  await db.insert(workspaceCredentialAudit).values({
    workspaceId: input.workspaceId,
    userId: input.userId,
    credentialKind: input.credentialKind,
    integrationId: input.integrationId ?? null,
    action: input.action,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    metadata: input.metadata ?? {},
  });
}
