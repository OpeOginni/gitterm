/**
 * Access tokens for OAuth credentials whose provider rotates refresh tokens.
 *
 * Workspaces never receive those refresh tokens. They ask here instead, and one
 * locked refresh per credential serves every workspace that shares it.
 */

import { and, db, eq } from "@gitterm/db";
import {
  modelCredentialAudit,
  modelProvider,
  userModelCredential,
} from "@gitterm/db/schema/model-credentials";
import { getModelProviderDefinition } from "@gitterm/schema/model-providers";
import { getEncryptionService, type OAuthCredential } from "../encryption";
import { OpenAIOAuthService } from "./oauth/openai-oauth";
import { OpencodeConsoleOAuthService } from "./oauth/opencode-console";
import { XaiOAuthService } from "./oauth/xai-oauth";

/** Longer than OpenCode's 5 minute refresh margin, so a returned token is not refreshed again at once. */
const MIN_REMAINING_MS = 10 * 60 * 1000;

/** Reasons that are safe to show the workspace; anything else is reported generically. */
export class ModelCredentialUnavailableError extends Error {}

export interface WorkspaceModelToken {
  access: string;
  expires: number;
  metadata: Record<string, string>;
}

export async function refreshModelOAuthCredential(
  plugin: string | null,
  current: OAuthCredential,
): Promise<OAuthCredential> {
  if (plugin === "oauth") {
    const tokens = await OpenAIOAuthService.refreshToken(current.refresh);
    return {
      ...current,
      refresh: tokens.refreshToken,
      access: tokens.accessToken,
      expires: tokens.expiresAt,
      accountId: tokens.accountId ?? current.accountId,
    };
  }
  if (plugin === "opencode-console") {
    const tokens = await OpencodeConsoleOAuthService.refreshToken(current.refresh);
    const metadata = { ...current.metadata };
    if (tokens.orgId && tokens.orgId !== metadata.orgID) {
      metadata.orgID = tokens.orgId;
      metadata.orgName = tokens.orgId;
    }
    return {
      ...current,
      refresh: tokens.refreshToken,
      access: tokens.accessToken,
      expires: tokens.expiresAt,
      metadata,
    };
  }
  if (plugin === "xai-oauth") {
    const tokens = await XaiOAuthService.refreshToken(current.refresh);
    return {
      ...current,
      refresh: tokens.refreshToken,
      access: tokens.accessToken,
      expires: tokens.expiresAt,
    };
  }
  throw new ModelCredentialUnavailableError("This credential is not refreshed by GitTerm");
}

function toToken(credential: OAuthCredential): WorkspaceModelToken {
  return {
    access: credential.access ?? "",
    expires: credential.expires ?? 0,
    metadata: {
      ...credential.metadata,
      ...(credential.accountId ? { accountID: credential.accountId } : {}),
    },
  };
}

/**
 * Returns the stored OAuth credential, refreshing it first when it expires within
 * `minRemainingMs`. The row lock makes concurrent callers wait and reuse the result.
 */
export async function getFreshModelOAuthCredential(
  input: {
    userId: string;
    credentialId: string;
    minRemainingMs?: number;
    workspaceId?: string;
  },
  refresh: typeof refreshModelOAuthCredential = refreshModelOAuthCredential,
): Promise<OAuthCredential> {
  const { userId, credentialId, minRemainingMs = MIN_REMAINING_MS } = input;
  const encryption = getEncryptionService();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        encryptedCredential: userModelCredential.encryptedCredential,
        providerId: userModelCredential.providerId,
      })
      .from(userModelCredential)
      .where(
        and(
          eq(userModelCredential.id, credentialId),
          eq(userModelCredential.userId, userId),
          eq(userModelCredential.isActive, true),
        ),
      )
      .for("update");
    if (!row) throw new ModelCredentialUnavailableError("Credential was revoked or deleted");

    const [provider] = await tx
      .select({ name: modelProvider.name, plugin: modelProvider.plugin })
      .from(modelProvider)
      .where(eq(modelProvider.id, row.providerId));
    if (!provider || !getModelProviderDefinition(provider.name)?.refreshedByGitterm) {
      throw new ModelCredentialUnavailableError("This credential is not refreshed by GitTerm");
    }

    const current = encryption.decryptCredential(row.encryptedCredential);
    if (current.type !== "oauth") {
      throw new ModelCredentialUnavailableError("This credential is not an OAuth account");
    }
    if (current.access && (current.expires ?? 0) > Date.now() + minRemainingMs) return current;

    const next = await refresh(provider.plugin, current);
    const now = new Date();
    await tx
      .update(userModelCredential)
      .set({
        encryptedCredential: encryption.encryptCredential(next),
        oauthExpiresAt: next.expires ? new Date(next.expires) : null,
        updatedAt: now,
      })
      .where(eq(userModelCredential.id, credentialId));
    await tx.insert(modelCredentialAudit).values({
      credentialId,
      userId,
      action: "refreshed",
      context: input.workspaceId ? { workspaceId: input.workspaceId } : null,
    });
    return next;
  });
}

export async function issueWorkspaceModelToken(
  ws: {
    id: string;
    userId: string;
    status: "pending" | "running" | "paused" | "terminated";
    modelCredentialIds: string[];
  },
  credentialId: string,
  refresh: typeof refreshModelOAuthCredential = refreshModelOAuthCredential,
): Promise<WorkspaceModelToken> {
  // OpenCode resolves credentials while starting, before the workspace reports running.
  if (ws.status !== "running" && ws.status !== "pending") {
    throw new ModelCredentialUnavailableError("Workspace is not running");
  }
  if (!ws.modelCredentialIds.includes(credentialId)) {
    throw new ModelCredentialUnavailableError("Credential is not attached to this workspace");
  }
  const credential = await getFreshModelOAuthCredential(
    { userId: ws.userId, credentialId, workspaceId: ws.id },
    refresh,
  );
  await db
    .update(userModelCredential)
    .set({ lastUsedAt: new Date() })
    .where(eq(userModelCredential.id, credentialId));
  return toToken(credential);
}
