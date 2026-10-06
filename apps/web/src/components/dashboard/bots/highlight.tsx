import type { ReactNode } from "react";

export type CodeLanguage = "env" | "shell" | "ts";

/**
 * Just enough to read the snippets on the bot page: one pattern per language, each capture group
 * a token kind, in order.
 */
const PATTERNS: Record<CodeLanguage, { pattern: RegExp; kinds: string[] }> = {
  env: { pattern: /(#.*)|(^[A-Z0-9_]+)(?==)/gm, kinds: ["comment", "key"] },
  shell: {
    pattern: /(#.*)|("[^"]*"|'[^']*')|(^(?:docker|npx|bunx|node)\b)|(\s--?[a-zA-Z][\w-]*)|(\\$)/gm,
    kinds: ["comment", "string", "command", "flag", "punct"],
  },
  ts: {
    pattern:
      /(\/\/.*)|("[^"]*"|'[^']*'|`[^`]*`)|\b(import|from|const|await|export|return|new)\b|\b([A-Za-z_]\w*)(?=\()/g,
    kinds: ["comment", "string", "keyword", "fn"],
  },
};

const TOKEN_CLASS: Record<string, string> = {
  comment: "text-fg-4",
  key: "text-primary",
  command: "text-primary",
  keyword: "text-primary",
  string: "text-emerald-700 dark:text-emerald-300/90",
  flag: "text-sky-700 dark:text-sky-300/90",
  fn: "text-fg",
  punct: "text-fg-4",
};

export function highlight(code: string, language: CodeLanguage): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  const { pattern, kinds } = PATTERNS[language];
  for (const match of code.matchAll(pattern)) {
    const group = match.findIndex((value, index) => index > 0 && value);
    const text = match[group];
    const start = (match.index ?? 0) + match[0].indexOf(text ?? "");
    if (group < 1 || !text) continue;
    if (start > last) out.push(code.slice(last, start));
    out.push(
      <span key={start} className={TOKEN_CLASS[kinds[group - 1]!]}>
        {text}
      </span>,
    );
    last = start + text.length;
  }
  out.push(code.slice(last));
  return out;
}
