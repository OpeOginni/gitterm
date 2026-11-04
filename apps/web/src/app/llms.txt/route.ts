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
    "> Gitterm gives coding agents more room to work: sandboxes and cloud workspaces on the provider you choose. Gitterm runs no machines itself; it sits between your agent and providers such as E2B, Daytona, Vercel, Boat, exe.dev, Railway and AWS, so switching providers is a config change. The OpenCode sandbox plugin (`@gitterm/opencode-sandbox`) lets a local agent run commands, jobs, previews and artifacts in remote sandboxes, with your own provider keys or a Gitterm plan. Cloud workspaces run OpenCode, or T3 Code (which drives Codex and Claude Code), in the cloud, and `/cloud` (the `@gitterm/opencode-cloud` plugin) moves an OpenCode session there. Slack and Discord bots, an SDK and a CLI build on the same workspaces. Gitterm is open source and self-hostable.",
    [
      "Start here:",
      "",
      "- Remote sandboxes for a local OpenCode agent: `opencode plugin add @gitterm/opencode-sandbox`, then add a provider account to the plugin options. No Gitterm account is needed with your own provider key.",
      "- Move an OpenCode session to a cloud workspace: `opencode plugin add @gitterm/opencode-cloud`, sign in with `gitterm login` (`npm install -g @gitterm/cli`), then type `/cloud`.",
      `- Every docs page is markdown at its URL plus \`.md\`, or with \`Accept: text/markdown\`. Full docs in one file: ${SITE_URL}/llms-full.txt`,
    ].join("\n"),
    ...sections,
  ].join("\n\n");
  return new Response(body + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
