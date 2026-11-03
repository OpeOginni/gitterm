import { getAllSlugs, getPage, pageMarkdown } from "@/lib/docs/content";

// Served at /docs/<slug>.md through a rewrite in next.config.ts.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug: slug.split("/") }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const page = getPage((await params).slug.join("/"));
  if (!page) return new Response("Not found\n", { status: 404 });
  return new Response(pageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
