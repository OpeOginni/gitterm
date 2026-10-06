/** Commit attribution is independent of the credential used to push. */
export type GitIdentity = { name: string; email: string };
export type GitCommitIdentity = { author: GitIdentity; committer: GitIdentity };
export type GitHubCommitProfile = { id: number; login: string; name?: string | null };

export const GITTERM_COMMIT_IDENTITY: GitIdentity = {
  name: "GitTerm",
  email: "noreply@gitterm.dev",
};

export function githubCommitIdentity(profile: GitHubCommitProfile): GitIdentity {
  if (
    !Number.isSafeInteger(profile.id) ||
    profile.id <= 0 ||
    !/^[a-z\d-]+(?:\[bot\])?$/i.test(profile.login)
  ) {
    throw new Error("Invalid GitHub commit identity");
  }
  return {
    name: profile.name?.trim() || profile.login,
    email: `${profile.id}+${profile.login}@users.noreply.github.com`,
  };
}

export function resolveGitCommitIdentity(
  author: GitIdentity,
  showGitTermOnCommits = true,
  bot: GitIdentity = GITTERM_COMMIT_IDENTITY,
): GitCommitIdentity {
  return { author, committer: showGitTermOnCommits ? bot : author };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Runs in the checked-out repo before any user setup or agent starts. */
export function buildGitCommitIdentityCommand(identity: GitCommitIdentity): string {
  // `author.*` too: a repo's own author.* (left by an earlier workspace) beats user.*.
  const values = {
    "user.name": identity.author.name,
    "user.email": identity.author.email,
    "author.name": identity.author.name,
    "author.email": identity.author.email,
    "committer.name": identity.committer.name,
    "committer.email": identity.committer.email,
  };
  // Global defaults also cover repos the agent creates; local values override
  // any persisted repo identity from an earlier workspace.
  const command = Object.entries(values)
    .flatMap(([key, value]) => [
      `git config --global ${key} ${shellQuote(value)}`,
      `if git rev-parse --git-dir >/dev/null 2>&1; then git config --local ${key} ${shellQuote(value)}; fi`,
    ])
    .join(" &&\n");
  // Images without git (custom ones) skip this rather than fail before the agent starts.
  return `if command -v git >/dev/null 2>&1; then (\n${command}\n) || exit $?; fi`;
}
