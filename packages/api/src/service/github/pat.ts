import { and, db, eq } from "@gitterm/db";
import { githubPatConnection } from "@gitterm/db/schema/integrations";
import { EncryptionService } from "../encryption";

export async function readGithubPat(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(githubPatConnection)
    .where(and(eq(githubPatConnection.id, id), eq(githubPatConnection.userId, userId)));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    accountLogin: row.accountLogin,
    token: new EncryptionService().decrypt(row.encryptedToken, `github:pat:${row.id}`),
  };
}
