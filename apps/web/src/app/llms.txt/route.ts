import { SITE_URL, getNav } from "@/lib/docs/content";

export const dynamic = "force-static";

export function GET() {
  const sections = getNav().map((s) =>
    [
      `## ${s.title}`,
      "",
      ...s.pages.map(
        (p) =>
          `- [${p.title}](${SITE_URL}/docs/${p.slug}.md)${p.description ? `: ${p.description}` : ""}`,
      ),
    ].join("\n"),
  );
  const body = [
    "# Gitterm",
    "> Gitterm gives coding agents more room to work: sandboxes and cloud workspaces on the provider you choose. Gitterm runs no machines itself; it sits between your agent and providers such as E2B, Daytona, Vercel, Boat, exe.dev, Railway and AWS, so switching providers is a config change. Sandbox tools let a local agent (OpenCode, Pi, Codex or Claude Code) run commands, jobs, previews and artifacts in remote sandboxes, with your own provider keys or a Gitterm plan. Cloud workspaces run OpenCode, Pi, or T3 Code (which drives Codex and Claude Code), in the cloud, and `/cloud` moves a local session there. Slack and Discord bots, an SDK and a CLI build on the same workspaces. Gitterm is open source and self-hostable.",
    [
      "Start here:",
      "",
      "- Set up every agent on a machine: `npx @gitterm/cli setup`. It installs `@gitterm/opencode` for OpenCode and Gitterm's Pi extension, adds the gitterm-cloud and gitterm-sandbox skills for Codex, Claude Code and other agents, and signs you in.",
      "- Remote sandboxes for a local agent: signed in, they are billed to your Gitterm plan. With your own provider key, no Gitterm account is needed: put the account under `sandbox` in the `@gitterm/opencode` options, or run `gitterm sandbox setup`, which writes `~/.config/gitterm/sandbox.json` for every agent.",
      "- Turn sandboxes or cloud moves off for one project: `gitterm project disable sandbox` (or `cloud`, `all`) saves it for that checkout on this machine (not in the repository), and every Gitterm integration honours it.",
      "- Move a session to a cloud workspace: type `/cloud` in OpenCode or Pi, or ask another agent to move its session; the first time, it asks you to sign in to Gitterm or create an account. Bring it back with `/cloud-return`.",
      `- Every docs page is markdown at its URL plus \`.md\`, or with \`Accept: text/markdown\`. Full docs in one file: ${SITE_URL}/llms-full.txt`,
    ].join("\n"),
    ...sections,
  ].join("\n\n");
  return new Response(body + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
