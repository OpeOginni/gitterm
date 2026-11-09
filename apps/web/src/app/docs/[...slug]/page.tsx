import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { CopyButton } from "@/components/site/copy-button";
import { DocsToc } from "@/components/docs/docs-toc";
import { Markdown } from "@/components/logos/Markdown";
import { EDIT_BASE, getAllSlugs, getNeighbours, getPage, pageMarkdown } from "@/lib/docs/content";
import { renderMarkdown } from "@/lib/docs/markdown";

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug: slug.split("/") }));
}

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = getPage((await params).slug.join("/"));
  if (!page) return {};
  return {
    title: `${page.title} · Gitterm docs`,
    description: page.description,
    alternates: {
      canonical: `/docs/${page.slug}`,
      types: { "text/markdown": `/docs/${page.slug}.md` },
    },
    openGraph: { title: page.title, description: page.description, url: `/docs/${page.slug}` },
  };
}

const ACTION =
  "inline-flex h-11 items-center gap-2 rounded-lg sm:h-9 bg-white/[0.04] px-3 text-[13.5px] font-medium text-fg-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors hover:bg-white/[0.07] hover:text-fg";

export default async function DocPage({ params }: Props) {
  const page = getPage((await params).slug.join("/"));
  if (!page) notFound();
  const { content, toc } = await renderMarkdown(page.body);
  const { prev, next } = getNeighbours(page.slug);

  return (
    <div className="min-[1180px]:grid min-[1180px]:grid-cols-[minmax(0,1fr)_200px] min-[1180px]:gap-12 min-[1360px]:gap-16">
      <article className="max-w-[740px] min-w-0 pt-8 pb-16 lg:pt-12 min-[1180px]:mx-auto min-[1180px]:w-full">
        <header className="mb-10 border-b border-line pb-8">
          <h1 className="m-0 text-[clamp(2rem,3.4vw,2.6rem)] leading-[1.1] font-display font-medium tracking-[-0.025em] text-balance text-fg">
            {page.title}
          </h1>
          {page.description && (
            <p className="mt-3.5 mb-0 text-[17px] leading-[1.6] text-pretty text-fg-3">
              {page.description}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <CopyButton value={pageMarkdown(page)} label="Copy page" icon className={ACTION} />
            <a href={`/docs/${page.slug}.md`} className={ACTION}>
              <Markdown className="h-[11px] w-auto shrink-0" />
              View as markdown
            </a>
          </div>
        </header>

        <div className="text-[16.5px] leading-[1.75] text-fg-2 [&_:not(pre)>code]:rounded-[5px] [&_:not(pre)>code]:bg-fill-2 [&_:not(pre)>code]:px-[0.35em] [&_:not(pre)>code]:py-[0.1em] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.86em] [&_:not(pre)>code]:text-fg [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0 [&_hr]:my-12 [&_hr]:border-line [&_img]:rounded-[10px] [&_input]:mr-2 [&_input]:accent-primary [&_li]:my-1.5 [&_li>ul]:my-1.5 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-5 [&_strong]:font-medium [&_strong]:text-fg [&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_li::marker]:text-fg-4 [&>*:first-child]:mt-0">
          {content}
        </div>

        <footer className="mt-16">
          <a
            href={`${EDIT_BASE}/${page.slug}.md`}
            target="_blank"
            rel="noreferrer"
            className="text-[14px] text-fg-3 transition-colors hover:text-fg"
          >
            Edit this page on GitHub
          </a>
          {(prev || next) && (
            <nav
              aria-label="Previous and next"
              className="mt-6 grid gap-3 border-t border-line pt-6 sm:grid-cols-2"
            >
              {prev ? (
                <Link
                  href={`/docs/${prev.slug}` as Route}
                  className="group flex flex-col gap-1 rounded-[10px] px-4 py-3.5 transition-colors hover:bg-fill"
                >
                  <span className="flex items-center gap-1.5 text-[13px] text-fg-4">
                    <ArrowLeft className="size-3.5" /> Previous
                  </span>
                  <span className="text-[15.5px] text-fg-2 group-hover:text-fg">{prev.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={`/docs/${next.slug}` as Route}
                  className="group flex flex-col items-end gap-1 rounded-[10px] px-4 py-3.5 text-right transition-colors hover:bg-fill"
                >
                  <span className="flex items-center gap-1.5 text-[13px] text-fg-4">
                    Next <ArrowRight className="size-3.5" />
                  </span>
                  <span className="text-[15.5px] text-fg-2 group-hover:text-fg">{next.title}</span>
                </Link>
              )}
            </nav>
          )}
        </footer>
      </article>

      <div className="hidden min-[1180px]:block">
        <DocsToc items={toc} />
      </div>
    </div>
  );
}
