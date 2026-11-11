import type { WorkspaceRepoProvisioning } from "./compute";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * A shell prefix that lets Git in the command that follows authenticate with the
 * repository token, without configuring anything on the machine. Empty without a token.
 * For providers that clone through their SDK and so have no credential helper set up.
 */
export function gitCredentialPrefix(repo: WorkspaceRepoProvisioning): string {
  if (!repo.authToken) return "";
  const helper =
    '!f() { [ "$1" = get ] || exit 0; echo "username=$GITTERM_GIT_USERNAME"; echo "password=$GITTERM_GIT_TOKEN"; }; f';
  return `GITTERM_GIT_USERNAME=${shellQuote(repo.authUsername ?? "x-access-token")} GITTERM_GIT_TOKEN=${shellQuote(repo.authToken)} GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=${shellQuote(helper)} `;
}

/**
 * Shell that puts the repository into the current directory of a machine. On a fresh
 * machine that is a clone. A machine started from a project snapshot already holds a clone
 * from the workspace it was saved from: that one is brought to what a fresh clone would be,
 * keeping the files Git ignores (installed dependencies, build caches), which is what makes
 * starting from a snapshot worth it.
 *
 * Git credentials must be configured before it runs, as for a clone. `cloneArguments` are
 * the provider's own extra `git clone` arguments (depth, single branch).
 */
export function repositoryCheckoutCommand(
  repo: WorkspaceRepoProvisioning,
  url: string,
  cloneArguments = "",
): string {
  const ref = repo.checkoutRef || repo.branch || "";
  const clone = `GIT_TERMINAL_PROMPT=0 git clone${cloneArguments ? ` ${cloneArguments}` : ""}${ref ? ` --branch ${shellQuote(ref)}` : ""} ${shellQuote(url)} .`;
  return [
    "set -e",
    // Not a checkout (a fresh machine, or a snapshot without one): clone as usual.
    `if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then ${clone}; exit 0; fi`,
    `git remote set-url origin ${shellQuote(url)}`,
    "GIT_TERMINAL_PROMPT=0 git fetch --prune origin",
    "git remote set-head origin --auto >/dev/null 2>&1 || true",
    `ref=${shellQuote(ref)}`,
    `if [ -z "$ref" ]; then ref=$(git symbolic-ref --short refs/remotes/origin/HEAD); ref=\${ref#origin/}; fi`,
    // A branch follows origin; anything else (a tag, a commit) is checked out as it is.
    `git checkout -q -f -B "$ref" "origin/$ref" 2>/dev/null || git checkout -q -f --detach "$ref"`,
    "git reset -q --hard",
    // Without -x: untracked leftovers go, ignored files stay.
    "git clean -q -fd",
    // The earlier workspace's handoff bookkeeping does not describe this one.
    `rm -f "$(git rev-parse --git-dir)/gitterm-handoff.json"`,
  ].join("\n");
}

/**
 * Shell run in a workspace just before its disk is saved as a project snapshot. The
 * workspace is deleted afterwards, so nothing in it has to keep working. It stops the agent
 * and removes what must not be kept: credentials GitTerm wrote, and the agent's own data,
 * which holds the conversations of the session that is ending. Every step is best effort.
 */
export const SCRUB_WORKSPACE_COMMAND = [
  "rm -rf /tmp/gitterm-repository-auth /tmp/gitterm-git-askpass /tmp/agent-server.log 2>/dev/null || true",
  "(rm -rf /run/gitterm 2>/dev/null || sudo -n rm -rf /run/gitterm 2>/dev/null) || true",
  'rm -f "$HOME/.gitterm/opencode/credentials.json" "$HOME/.gitterm/github/config.json" "$HOME/.gitterm/callback.env" 2>/dev/null || true',
  'rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/opencode" "${OPENCODE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode}" 2>/dev/null || true',
  "git config --global --unset-all credential.helper 2>/dev/null || true",
  "sync 2>/dev/null || true",
].join("; ");
export const PREPARE_PROJECT_SNAPSHOT_COMMAND = [
  "pkill -f 'opencode serve' 2>/dev/null || true",
  "sleep 1",
  SCRUB_WORKSPACE_COMMAND,
].join("; ");
