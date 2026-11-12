import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/**
 * JSON with soft colours: keys blue, strings green, numbers orange, `{env:…}` in gold. Server-renderable: returns React nodes, no innerHTML.
 */
export function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b\d+\b)|([{}[\],:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const [, str, colon, num, pun] = m;
    if (str && colon) {
      out.push(
        <span key={k++} className="text-[#a9c1ff]">
          {str}
        </span>,
        <span key={k++} className="text-fg-4">
          {colon}
        </span>,
      );
    } else if (str) {
      const hot = str.includes("env:");
      out.push(
        <span key={k++} className={hot ? "text-[#e2c47c]" : "text-[#b9d9a8]"}>
          {str}
        </span>,
      );
    } else if (num) {
      out.push(
        <span key={k++} className="text-[#f0b98a]">
          {num}
        </span>,
      );
    } else {
      out.push(
        <span key={k++} className="text-fg-4">
          {pun}
        </span>,
      );
    }
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

/** A dark code block. `json` gets colours; anything else renders as plain mono text. */
export function CodeBlock({
  code,
  lang,
  copy = false,
  className,
  children,
}: {
  code: string;
  lang?: "json" | "text";
  copy?: boolean;
  className?: string;
  /** Pre-highlighted content to show instead of `code` (copy still uses `code`). */
  children?: ReactNode;
}) {
  // Copy covers only the right end of the top line. A short top line (24 characters fits even a
  // phone) keeps it inside; a long one would run under it, so below `lg` it moves under the block.
  const inside = (code.split("\n")[0] ?? "").length <= 24;
  return (
    <div className={cn("relative", !inside && "flex flex-col lg:block", className)}>
      <pre className="m-0 overflow-x-auto rounded-[10px] border border-line bg-[#0b0b0e] px-5 py-4 font-mono text-[13px] leading-[1.75] text-fg-2 [scrollbar-width:thin]">
        {children ?? (lang === "json" ? highlightJson(code) : code)}
      </pre>
      {copy && (
        <CopyButton
          value={code}
          className={
            inside
              ? "absolute top-2.5 right-2.5"
              : "mt-2 self-end lg:absolute lg:top-2.5 lg:right-2.5 lg:mt-0"
          }
        />
      )}
    </div>
  );
}

/** One-line shell command with a "$" prompt and a copy button. */
export function InstallCommand({
  command,
  className,
  location,
}: {
  command: string;
  className?: string;
  /** Where on the site this sits, for the copy event. */
  location: "hero" | "cta";
}) {
  // One line always, with Copy in the box. Where the command doesn't fit it scrolls and fades
  // out; the padding under the fade keeps the end readable once scrolled to it.
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-background/70 py-2 pr-2 pl-3.5 font-mono text-[13.5px] text-fg-2",
        className,
      )}
    >
      <span className="min-w-0 overflow-x-auto pr-4 whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] [scrollbar-width:none]">
        <span className="text-fg-4">$ </span>
        {command}
      </span>
      <CopyButton value={command} installLocation={location} />
    </div>
  );
}
