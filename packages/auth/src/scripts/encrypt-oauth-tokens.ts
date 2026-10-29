import { and, db, eq } from "@gitterm/db";
import { account } from "@gitterm/db/schema/auth";
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { getOAuthEncryptionContext } from "../index";
import env from "@gitterm/env/auth";

const apply = process.argv.includes("--apply");
let checked = 0;
let candidates = 0;
let updated = 0;
let conflicts = 0;

try {
  const context = await getOAuthEncryptionContext();
  if (!env.AUTH_ENCRYPT_OAUTH_TOKENS) {
    throw new Error("OAuth encryption must be enabled before migration");
  }
  for (const row of await db.select().from(account)) {
    for (const field of ["accessToken", "refreshToken"] as const) {
      const value = row[field];
      if (!value) continue;
      const plaintext = await decryptOAuthToken(value, context);
      checked++;
      if (plaintext !== value) continue;
      candidates++;
      if (!apply) continue;
      const encrypted = await setTokenUtil(value, context);
      if (
        !encrypted ||
        encrypted === value ||
        (await decryptOAuthToken(encrypted, context)) !== value
      ) {
        throw new Error("OAuth encryption verification failed");
      }
      const result = await db
        .update(account)
        .set({ [field]: encrypted })
        .where(
          and(
            eq(account.id, row.id),
            eq(account.userId, row.userId),
            eq(account.providerId, row.providerId),
            eq(account[field], value),
          ),
        )
        .returning({ id: account.id });
      if (result.length) updated++;
      else conflicts++;
    }
  }
  console.log(
    JSON.stringify({ mode: apply ? "apply" : "dry-run", checked, candidates, updated, conflicts }),
  );
  if (conflicts) {
    console.error(
      "OAuth tokens changed concurrently. Re-run until candidates and conflicts are zero.",
    );
    process.exitCode = 1;
  }
} catch {
  console.error(
    "OAuth migration failed. Check AUTH_ENCRYPT_OAUTH_TOKENS, the existing Better Auth secret, and token formats. No secret values were logged; completed updates are safe to rerun.",
  );
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
