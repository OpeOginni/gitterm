import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * How an agent moves its own session: every supported agent reads skills, so one skill works
 * for all of them. It runs the `gitterm` CLI, which finds the session from the agent's
 * environment.
 */
export const SKILL = `---
name: gitterm-cloud
description: Move this coding session to a GitTerm cloud workspace and back. Use when the user asks to continue in the cloud, move or send this session to GitTerm, or bring it back from the cloud.
---

# GitTerm cloud

Run these with your shell tool. If \`gitterm\` is not installed, use \`npx -y @gitterm/cli\`
instead. If a command says the user is not signed in, ask them to run \`gitterm login\` and stop.
In OpenCode and Pi, their \`/cloud\` and \`/cloud-return\` commands do the same.

## Move this session to the cloud

\`\`\`sh
gitterm move "<what the cloud agent should do next>"
\`\`\`

It copies this checkout (commits and uncommitted changes; add \`--no-changes\` to leave
uncommitted changes behind) and this conversation to a new GitTerm workspace, where the same
conversation continues. It takes a minute or two. When it prints the result:

- Tell the user the work continues in the cloud, and give them every link it printed, exactly
  as printed.
- Then stop. Do not keep working here: further work here would not reach the cloud.

## Bring it back

In the session that moved (here, on the user's machine):

\`\`\`sh
gitterm return
\`\`\`

It waits until this reply ends, then brings the cloud's commits, changes and conversation back
into this session, which wakes up with a summary. Tell the user that and stop. If it says the
checkout or session changed since the move, explain it, and rerun with \`--force\` only if the
user agrees (their local work is kept in a Git stash, a branch and a copy of the session).
`;

/** Every agent's global skills folder: Claude Code, Codex and others (~/.agents), Pi. */
export function skillDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir();
  return [
    path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "skills"),
    path.join(home, ".agents", "skills"),
    path.join(env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"), "skills"),
  ];
}

export async function installSkill(): Promise<string[]> {
  const files = skillDirectories().map((dir) => path.join(dir, "gitterm-cloud", "SKILL.md"));
  for (const file of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, SKILL);
  }
  return files;
}
