import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Agents in T3 Code run Claude Code or Codex, and T3 Code shows their skills in its `/` and
 * `$` menus. This skill is how a thread moves itself: there is no T3 Code plugin API.
 */
export const SKILL = `---
name: gitterm-cloud
description: Move this T3 Code thread to a GitTerm cloud workspace and back, or start a cloud machine to hand tasks to. Use when the user asks to continue in the cloud, move or send this thread to GitTerm, bring it back from the cloud, or run work on a cloud machine.
---

# GitTerm cloud for T3 Code

Run these with Bash. If \`gitterm\` is not installed, use \`npx -y @gitterm/cli\` instead.
If a command says the user is not signed in, ask them to run \`gitterm login\` and stop.

## Move this thread to the cloud

\`\`\`sh
gitterm t3 move "<what the cloud agent should do next>"
\`\`\`

It copies this checkout (commits and uncommitted changes; add \`--no-changes\` to leave
uncommitted changes behind) and this conversation to a new GitTerm workspace, where the same
conversation continues as a new thread. It takes a minute or two. When it prints the result:

- Tell the user the work continues in the cloud, and give them the cloud thread's link exactly
  as printed (it looks like \`t3-thread://v2/...\`), and the app link if there is one.
- Then stop. Do not keep working here: further work here would not reach the cloud.

Only Claude Code threads can move so far.

## Bring it back

In the thread that moved (here, on the user's machine):

\`\`\`sh
gitterm t3 return
\`\`\`

It waits until this reply ends, then brings the cloud's commits, changes and conversation back
into this thread, which wakes up with a summary. Tell the user that and stop. If it says the
checkout or thread changed since the move, explain it, and rerun with \`--force\` only if the user
agrees (their local work is kept in a Git stash, a branch and a copy of the session).

## A cloud machine to hand tasks to

\`\`\`sh
gitterm t3 create
\`\`\`

It starts a workspace with this repository's pushed default branch (\`--ref <branch>\` for
another; push local work first) and links it to this T3 Code. Pass the printed
\`environmentId\` and \`projectId\` as \`target.environmentId\` and \`target.projectId\` to
\`delegate_task\`. Several tasks can share it. Delete it with \`gitterm t3 delete <workspaceId>\`
when done; until then it pauses when idle and can be billed.
`;

/** Installs the skill for Claude Code and for Codex and other agents that read ~/.agents. */
export async function installSkill(): Promise<string[]> {
  const files = [
    path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "skills"),
    path.join(homedir(), ".agents", "skills"),
  ].map((dir) => path.join(dir, "gitterm-cloud", "SKILL.md"));
  for (const file of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, SKILL);
  }
  return files;
}
