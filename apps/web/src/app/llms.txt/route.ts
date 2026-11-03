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
    "> Gitterm gives coding agents more computers. The OpenCode sandbox tools plugin (`@gitterm/opencode-sandbox-tools`) lets a local agent run commands, jobs, previews and artifacts in remote sandboxes on E2B, Daytona, Vercel, Boat, exe.dev, Railway or AWS, with your own provider keys or a Gitterm plan. Cloud workspaces run OpenCode, or T3 Code (which drives Codex and Claude Code), in the cloud, and `/cloud` (the `@gitterm/opencode-cloud-handoff` plugin) moves an OpenCode session there. Slack and Discord bots, an SDK and a CLI build on the same workspaces. Gitterm is open source and self-hostable.",
    `Full docs in one file: ${SITE_URL}/llms-full.txt`,
    ...sections,
  ].join("\n\n");
  return new Response(body + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
