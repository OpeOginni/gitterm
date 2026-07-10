import { createHash, randomBytes } from "crypto";
import { db, eq, and, isNull } from "@gitterm/db";
import { apiToken } from "@gitterm/db/schema/auth";

/**
 * User API tokens (personal access tokens).
 *
 * Tokens look like `gt_<43 chars of base64url>`. Only the SHA-256 hash is
 * persisted; the plaintext is returned once at creation. Verification is a
 * DB lookup, so tokens are revocable from the web UI. Both dashboard-created
 * tokens and CLI device-code logins use this single mechanism.
 */

const TOKEN_PREFIX = "gt_";
const TOKEN_BYTES = 32;
/** Characters of the token shown in the UI to tell tokens apart, e.g. "gt_a1b2c3". */
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

export function isApiToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ApiTokenMetadata = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};

export async function createApiToken(params: {
  userId: string;
  name: string;
  expiresInDays?: number | null;
}): Promise<{ token: string; record: ApiTokenMetadata }> {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [record] = await db
    .insert(apiToken)
    .values({
      userId: params.userId,
      name: params.name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
      expiresAt,
    })
    .returning();

  if (!record) throw new Error("Failed to create API token");

  return {
    token,
    record: {
      id: record.id,
      name: record.name,
      tokenPrefix: record.tokenPrefix,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
    },
  };
}

/**
 * Verify an opaque `gt_...` token. Returns the owning userId, or null when
 * the token is unknown, revoked, or expired.
 *
 * Updates `lastUsedAt` fire-and-forget so verification stays a single
 * round-trip on the hot path.
 */
export async function verifyApiToken(token: string): Promise<{ userId: string } | null> {
  const [record] = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.tokenHash, hashToken(token)), isNull(apiToken.revokedAt)))
    .limit(1);

  if (!record) return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

  void db
    .update(apiToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiToken.id, record.id))
    .catch(() => {
      // Best-effort bookkeeping; never fail auth over it.
    });

  return { userId: record.userId };
}

export async function listApiTokens(userId: string): Promise<ApiTokenMetadata[]> {
  const records = await db
    .select({
      id: apiToken.id,
      name: apiToken.name,
      tokenPrefix: apiToken.tokenPrefix,
      createdAt: apiToken.createdAt,
      expiresAt: apiToken.expiresAt,
      lastUsedAt: apiToken.lastUsedAt,
    })
    .from(apiToken)
    .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)));

  return records.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Revoke one of the user's tokens. Returns false when it doesn't exist (or isn't theirs). */
export async function revokeApiToken(params: {
  userId: string;
  tokenId: string;
}): Promise<boolean> {
  const [updated] = await db
    .update(apiToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiToken.id, params.tokenId),
        eq(apiToken.userId, params.userId),
        isNull(apiToken.revokedAt),
      ),
    )
    .returning({ id: apiToken.id });

  return !!updated;
}
