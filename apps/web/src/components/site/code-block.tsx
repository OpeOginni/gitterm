import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/**
 * JSON with soft colours: keys blue, strings green, numbers orange, `{env:…}` and
 * `"managed"` in gold. Server-renderable: returns React nodes, no innerHTML.
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
      const hot = /env:|managed/.test(str);
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
export function InstallCommand({ command, className }: { command: string; className?: string }) {
  // One line always. On phones the command scrolls in its box and Copy sits below it;
  // from `sm` up, Copy sits inside the box.
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-col items-center gap-2 font-mono text-[13.5px] text-fg-2 sm:flex-row sm:gap-3 sm:rounded-lg sm:border sm:border-line sm:bg-background/70 sm:py-2 sm:pr-2 sm:pl-3.5",
        className,
      )}
    >
      <span className="max-w-full min-w-0 overflow-x-auto rounded-lg border border-line bg-background/70 px-3.5 py-2.5 whitespace-nowrap [scrollbar-width:none] sm:border-0 sm:bg-transparent sm:p-0">
        <span className="text-fg-4">$ </span>
        {command}
      </span>
      <CopyButton value={command} />
    </div>
  );
}
