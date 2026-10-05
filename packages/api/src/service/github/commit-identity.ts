import { Octokit } from "@octokit/rest";
import { and, db, eq } from "@gitterm/db";
import { account, type user } from "@gitterm/db/schema/auth";
import { getGitHubAppService } from ".";
import { githubRepositoryMode } from "./config";
import {
  githubCommitIdentity,
  resolveGitCommitIdentity,
  type GitIdentity,
} from "../git-commit-identity";
import { logger } from "../../utils/logger";

type CommitUser = Pick<
  typeof user.$inferSelect,
  "id" | "name" | "email" | "emailVerified" | "showGitTermOnCommits"
>;

/** Workspace creation waits on this, so GitHub gets a short leash. */
const GITHUB_TIMEOUT_MS = 3_000;

export async function getWorkspaceCommitIdentity(currentUser: CommitUser) {
  const linked = await db.query.account.findFirst({
    where: and(eq(account.userId, currentUser.id), eq(account.providerId, "github")),
    columns: { accountId: true, accessToken: true },
  });
  const name = currentUser.name.trim() || "GitTerm user";
  // Never an address that could be someone's private one: a GitHub sign-in's app email is
  // their primary GitHub email, and pushing it can be refused (GH007) or leak it.
  const unlinked = `${currentUser.id}@users.noreply.gitterm.invalid`;
  let githubLogin: string | undefined;
  let author: GitIdentity = {
    name,
    email: !linked && currentUser.emailVerified ? currentUser.email : unlinked,
  };
  if (linked?.accessToken && /^\d+$/.test(linked.accountId)) {
    try {
      // The user's own linked account, never the installation owner (which may be an org).
      const { data } = await new Octokit({ auth: linked.accessToken }).users.getById({
        account_id: Number(linked.accountId),
        request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
      });
      if (String(data.id) !== linked.accountId) throw new Error("GitHub account ID mismatch");
      author = githubCommitIdentity(data);
      githubLogin = data.login;
    } catch {
      logger.warn("Could not resolve the linked GitHub commit identity", {
        userId: currentUser.id,
        action: "resolve_commit_author",
      });
    }
  }

  let bot: GitIdentity | undefined;
  if (currentUser.showGitTermOnCommits) {
    try {
      if ((await githubRepositoryMode())?.mode === "app") {
        bot = await (await getGitHubAppService()).getCommitIdentity();
      }
    } catch {
      logger.warn("Could not resolve the GitHub App bot; committing as GitTerm", {
        action: "resolve_commit_committer",
      });
    }
  }
  return {
    githubLogin,
    identity: resolveGitCommitIdentity(author, currentUser.showGitTermOnCommits, bot),
  };
}
