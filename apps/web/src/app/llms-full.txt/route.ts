import { getNavPages, pageMarkdown } from "@/lib/docs/content";

export const dynamic = "force-static";

export function GET() {
  const body = getNavPages().map(pageMarkdown).join("\n---\n\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
