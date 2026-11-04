import { readFileSync } from "node:fs";
import path from "node:path";
import { cache } from "react";

/**
 * Docs content lives in `apps/web/content/docs`: one markdown file per page
 * (`<slug>.md`, slugs may contain one `/`) and `nav.json` for the order.
 * Pages listed in nav.json whose file doesn't exist yet are left out everywhere.
 */
const DOCS_DIR = path.join(process.cwd(), "content/docs");

const webUrl = process.env.NEXT_PUBLIC_WEB_URL?.replace(/\/$/, "");
/** Absolute base for llms.txt links. Ignores unresolved values like Railway's `${{...}}` references. */
export const SITE_URL =
  webUrl && /^https?:\/\/[\w.-]+(:\d+)?$/.test(webUrl) ? webUrl : "https://gitterm.dev";
export const EDIT_BASE = "https://github.com/OpeOginni/gitterm/edit/main/apps/web/content/docs";

export type DocPage = {
  slug: string;
  title: string;
  /** Short sidebar label (`nav:` frontmatter). The section name already gives context. Defaults to the title. */
  nav: string;
  description: string;
  /** Markdown body without the frontmatter. */
  body: string;
};

export type NavSection = { title: string; pages: DocPage[] };

/** `title: x` / `description: "y"` frontmatter. Single-line values only. */
function parseFrontmatter(src: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  const data: Record<string, string> = {};
  if (!match) return { data, body: src };
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    data[kv[1]!] = value;
  }
  return { data, body: src.slice(match[0].length) };
}

export const getPage = cache((slug: string): DocPage | null => {
  if (!/^[\w-]+(\/[\w-]+)?$/.test(slug)) return null;
  let src: string;
  try {
    src = readFileSync(path.join(DOCS_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(src);
  return {
    slug,
    title: data.title ?? slug,
    nav: data.nav ?? data.title ?? slug,
    description: data.description ?? "",
    body: body.trim(),
  };
});

/** Nav sections with only the pages that exist. Empty sections are dropped. */
export const getNav = cache((): NavSection[] => {
  const nav = JSON.parse(readFileSync(path.join(DOCS_DIR, "nav.json"), "utf8")) as {
    sections: { title: string; pages: string[] }[];
  };
  return nav.sections
    .map((s) => ({
      title: s.title,
      pages: s.pages.map(getPage).filter((p): p is DocPage => p !== null),
    }))
    .filter((s) => s.pages.length > 0);
});

export function getNavPages(): DocPage[] {
  return getNav().flatMap((s) => s.pages);
}

/** Every page file, in nav order first. Pages missing from nav.json still build but aren't linked. */
/** Only pages listed in nav.json are published, so unlisted drafts stay private (404). */
export function getAllSlugs(): string[] {
  return getNavPages().map((p) => p.slug);
}

export function getNeighbours(slug: string) {
  const pages = getNavPages();
  const i = pages.findIndex((p) => p.slug === slug);
  return { prev: i > 0 ? pages[i - 1] : undefined, next: i >= 0 ? pages[i + 1] : undefined };
}

/**
 * The page as one markdown document, title first. Used by "Copy page", `/docs/<slug>.md` and
 * llms-full.txt. Site links become absolute, and docs links point at the markdown version, so an
 * agent that follows a link gets markdown again instead of an HTML page.
 */
export function pageMarkdown(page: DocPage) {
  const body = page.body
    .replace(
      /\]\((\/docs\/[^)#\s]+)(#[^)\s]*)?\)/g,
      (_, url: string, hash = "") => `](${SITE_URL}${url}.md${hash})`,
    )
    .replace(/\]\((\/[^)\s]*)\)/g, (_, url: string) => `](${SITE_URL}${url})`);
  return [`# ${page.title}`, page.description, body].filter(Boolean).join("\n\n") + "\n";
}
