import Link from "next/link";
import type { Route } from "next";
import type { ComponentProps, ReactNode } from "react";
import type { Components } from "hast-util-to-jsx-runtime";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/site/copy-button";
import { cn } from "@/lib/utils";

function DocLink({ href = "", children, className, ...rest }: ComponentProps<"a">) {
  const cls = cn(
    "text-[#e2c47c] underline decoration-[#e2c47c]/40 underline-offset-[3px] transition-colors hover:decoration-[#e2c47c]",
    className,
  );
  if (href.startsWith("/")) {
    return (
      <Link href={href as Route} className={cls}>
        {children}
      </Link>
    );
  }
  const external = /^https?:/.test(href);
  return (
    <a
      href={href}
      className={cls}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

function Heading({ level, id, children }: { level: 2 | 3 | 4; id?: string; children?: ReactNode }) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      id={id}
      className={cn(
        "group scroll-mt-24 font-medium text-fg",
        level === 2 && "mt-14 mb-4 text-[1.55rem] leading-[1.25] tracking-[-0.025em]",
        level === 3 && "mt-10 mb-3 text-[1.18rem] leading-[1.35] tracking-[-0.015em]",
        level === 4 && "mt-8 mb-2 text-[1rem]",
      )}
    >
      <a href={`#${id}`} className="no-underline">
        {children}
        <span
          aria-hidden
          className="ml-2 text-fg-4 opacity-0 transition-opacity group-hover:opacity-100"
        >
          #
        </span>
      </a>
    </Tag>
  );
}

const LANG_LABEL: Record<string, string> = {
  sh: "Shell",
  bash: "Shell",
  json: "JSON",
  jsonc: "JSONC",
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  toml: "TOML",
  yaml: "YAML",
  diff: "Diff",
  dockerfile: "Dockerfile",
  ini: "INI",
  text: "Text",
};

/** Shiki's `<pre>`, with a language label and a copy button above the code. */
function CodeFigure(
  props: ComponentProps<"pre"> & { "data-language"?: string; "data-code"?: string },
) {
  const { children, style, "data-language": lang = "text", "data-code": code = "" } = props;
  return (
    <figure className="my-6 overflow-hidden rounded-[10px] border border-line bg-[#0b0b0e]">
      <figcaption className="flex h-11 items-center justify-between sm:h-10 gap-3 border-b border-line pr-2 pl-4">
        <span className="font-mono text-[12.5px] text-fg-4">{LANG_LABEL[lang] ?? lang}</span>
        <CopyButton value={code} className="max-sm:h-9 max-sm:px-3" />
      </figcaption>
      <pre
        style={{ ...style, backgroundColor: undefined }}
        className="m-0 overflow-x-auto px-4 py-3.5 font-mono text-[13.5px] leading-[1.7] [scrollbar-width:thin]"
      >
        {children}
      </pre>
    </figure>
  );
}

const ALERTS = {
  note: { label: "Note", Icon: Info, color: "text-[#a9c1ff]" },
  tip: { label: "Tip", Icon: Lightbulb, color: "text-[#6bd586]" },
  important: { label: "Important", Icon: Info, color: "text-[#e2c47c]" },
  warning: { label: "Warning", Icon: TriangleAlert, color: "text-[#fb923c]" },
  caution: { label: "Caution", Icon: TriangleAlert, color: "text-[#fb923c]" },
} as const;

function Blockquote({
  children,
  ...props
}: ComponentProps<"blockquote"> & { "data-alert"?: keyof typeof ALERTS }) {
  const alert = props["data-alert"] ? ALERTS[props["data-alert"]] : undefined;
  if (!alert) {
    return (
      <blockquote className="my-6 border-l-2 border-line-2 pl-4 text-fg-3">{children}</blockquote>
    );
  }
  const { label, Icon, color } = alert;
  return (
    <aside className="my-6 rounded-[10px] bg-fill px-4 py-3.5 text-[15.5px] [&>p]:my-1.5">
      <p className={cn("m-0 flex items-center gap-2 text-[14px] font-medium", color)}>
        <Icon aria-hidden className="size-4" />
        {label}
      </p>
      {children}
    </aside>
  );
}

export const markdownComponents: Partial<Components> = {
  a: DocLink,
  h2: (p) => <Heading level={2} {...p} />,
  h3: (p) => <Heading level={3} {...p} />,
  h4: (p) => <Heading level={4} {...p} />,
  pre: CodeFigure,
  blockquote: Blockquote,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full border-collapse text-left text-[14.5px] leading-[1.55]">
        {children}
      </table>
    </div>
  ),
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-b border-line-2 py-2.5 pr-6 align-bottom font-medium whitespace-nowrap text-fg"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-line py-2.5 pr-6 align-top text-fg-2">
      {children}
    </td>
  ),
};
