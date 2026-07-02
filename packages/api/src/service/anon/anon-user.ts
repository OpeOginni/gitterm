import { createHash, randomUUID } from "crypto";
import { db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { AnonTryRepository } from "@gitterm/redis";
import env from "@gitterm/env/server";

/**
 * Anonymous user resolver for the "try gitterm" homepage flow.
 *
 * The `workspace.userId` column is NOT NULL with a FK to `user.id`, so we can't
 * skip the user table. Instead we mint a synthetic, deterministic user per
 * IP-hash:
 *
 *   email = anon-<ip-hash-16>@anon.gitterm.local
 *   name  = "Anonymous · <ip-hash-8>"
 *
 * This means repeat anon launches from the same IP (after the 24h cooldown)
 * reuse the same user row — keeping their workspace count under a stable
 * quota and making cleanup tractable. The IP itself is never stored; only its
 * salted hash is derivable from anything in the database.
 */

export interface AnonUser {
  id: string;
  email: string;
  ipHash: string;
}

export const ANON_EMAIL_DOMAIN = "anon.gitterm.local";

/**
 * Returns true if the given email belongs to a synthetic anon user created
 * by the "try gitterm" homepage flow. Used to gate keep-alive / idle logic
 * so anon sandboxes honour their hard E2B timeout instead of being kept
 * alive by proxy interactions.
 */
export function isAnonEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${ANON_EMAIL_DOMAIN}`);
}

/**
 * Hash a raw client IP with a server-side salt. Returns 32 hex chars.
 * The salt prevents rainbow-table style reversal if the database leaks.
 */
export function hashClientIp(rawIp: string): string {
  const salt = env.ANON_IP_HASH_SALT ?? env.BETTER_AUTH_SECRET;
  if (!salt) {
    throw new Error(
      "ANON_IP_HASH_SALT or BETTER_AUTH_SECRET must be configured for anon IP hashing",
    );
  }
  return createHash("sha256").update(`${salt}::${rawIp.trim()}`).digest("hex").slice(0, 32);
}

/**
 * Get-or-create the synthetic anon user for a given IP-hash. Cached in Redis
 * so the common case is one Redis GET (no DB round-trip).
 */
export async function getOrCreateAnonUser(ipHash: string): Promise<AnonUser> {
  const repo = new AnonTryRepository();

  // Fast path: cached id from Redis
  const cachedId = await repo.getCachedUserId(ipHash);
  if (cachedId) {
    const [existing] = await db.select().from(user).where(eq(user.id, cachedId)).limit(1);
    if (existing) {
      return { id: existing.id, email: existing.email, ipHash };
    }
    // Cached id pointed to a deleted row — fall through to recreate.
  }

  const email = `anon-${ipHash.slice(0, 16)}@${ANON_EMAIL_DOMAIN}`;

  // Slow path: lookup by email or insert
  const [existingByEmail] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existingByEmail) {
    await repo.cacheUserId(ipHash, existingByEmail.id);
    return { id: existingByEmail.id, email: existingByEmail.email, ipHash };
  }

  const id = randomUUID();
  const now = new Date();
  await db
    .insert(user)
    .values({
      id,
      email,
      name: `Anonymous · ${ipHash.slice(0, 8)}`,
      emailVerified: false,
      plan: "free",
      role: "user",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: user.email });

  // Re-select in case onConflictDoNothing skipped (race with another request)
  const [created] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!created) {
    throw new Error("Failed to materialize anonymous user");
  }

  await repo.cacheUserId(ipHash, created.id);
  return { id: created.id, email: created.email, ipHash };
}
