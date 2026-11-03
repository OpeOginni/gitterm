import { Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Blockquote, Root as MdastRoot } from "mdast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import { markdownComponents } from "@/components/docs/markdown-components";

export type TocItem = { id: string; text: string; depth: 2 | 3 };

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/;

/** GitHub alerts: `> [!NOTE]` becomes `<blockquote data-alert="note">` without the marker. */
function remarkAlerts() {
  return (tree: MdastRoot) => {
    const visit = (node: MdastRoot | Blockquote) => {
      for (const child of node.children) {
        if (child.type !== "blockquote") continue;
        const first = child.children[0];
        const text = first?.type === "paragraph" ? first.children[0] : undefined;
        const m = text?.type === "text" ? ALERT.exec(text.value) : null;
        if (m && text?.type === "text" && first?.type === "paragraph") {
          text.value = text.value.slice(m[0].length);
          if (!text.value) first.children.shift();
          if (first.children[0]?.type === "break") first.children.shift();
          if (!first.children.length) child.children.shift();
          child.data = { ...child.data, hProperties: { dataAlert: m[1]!.toLowerCase() } };
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

function textOf(node: ElementContent | HastRoot): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map((c) => textOf(c as ElementContent)).join("");
  return "";
}

function collectToc(tree: HastRoot): TocItem[] {
  return tree.children.flatMap((node) =>
    node.type === "element" && (node.tagName === "h2" || node.tagName === "h3")
      ? [
          {
            id: String((node as Element).properties.id),
            text: textOf(node),
            depth: node.tagName === "h2" ? 2 : 3,
          } as const,
        ]
      : [],
  );
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkAlerts)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeShiki, {
    theme: "vesper",
    langs: [
      "sh",
      "bash",
      "json",
      "jsonc",
      "ts",
      "tsx",
      "js",
      "toml",
      "yaml",
      "diff",
      "dockerfile",
      "ini",
    ],
    defaultLanguage: "text",
    fallbackLanguage: "text",
    transformers: [
      {
        // Language label and raw source for the code block header and copy button.
        pre(node) {
          node.properties.dataLanguage = this.options.lang;
          node.properties.dataCode = this.source;
        },
      },
    ],
  });

/** Markdown body to React elements plus the h2/h3 outline for "On this page". */
export async function renderMarkdown(markdown: string) {
  const tree = (await processor.run(processor.parse(markdown))) as HastRoot;
  return {
    toc: collectToc(tree),
    content: toJsxRuntime(tree, { Fragment, jsx, jsxs, components: markdownComponents }),
  };
}
