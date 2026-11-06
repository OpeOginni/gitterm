import { getAllSlugs, getPage, pageMarkdown } from "@/lib/docs/content";

// Served at /docs/<slug>.md, and at /docs/<slug> for Accept: text/markdown, through rewrites in next.config.ts.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug: slug.split("/") }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const page = getPage((await params).slug.join("/"));
  if (!page) return new Response("Not found\n", { status: 404 });
  return new Response(pageMarkdown(page), {
    // The same URL can answer HTML or this markdown (Accept: text/markdown), so caches must key on Accept
    headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: "Accept" },
  });
}
