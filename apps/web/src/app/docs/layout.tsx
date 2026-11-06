import type { ReactNode } from "react";
import { SiteShell } from "@/components/site/site-shell";
import { Wrap } from "@/components/site/section";
import { DocsNav } from "@/components/docs/docs-nav";
import { getNav } from "@/lib/docs/content";

export default function DocsLayout({ children }: { children: ReactNode }) {
  const nav = getNav().map((s) => ({
    title: s.title,
    pages: s.pages.map((p) => ({ slug: p.slug, title: p.nav })),
  }));
  return (
    <SiteShell wide>
      <Wrap wide className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <DocsNav nav={nav} />
        <div className="min-w-0">{children}</div>
      </Wrap>
    </SiteShell>
  );
}
