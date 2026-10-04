const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function renderTable(lines: string[]): string {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line) =>
      line
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0), 3),
  );
  const render = (row: string[]) =>
    widths
      .map((width, column) => (row[column] ?? "").padEnd(width))
      .join(" | ")
      .trimEnd();
  const body = [
    render(rows[0] ?? []),
    widths.map((width) => "-".repeat(width)).join("-+-"),
    ...rows.slice(1).map(render),
  ];
  return ["```", ...body.map((line) => line.replaceAll("```", "'''")), "```"].join("\n");
}

/** Markdown tables as monospaced code blocks, for chats that do not render tables. */
export function tablesToCode(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inCode = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trimStart().startsWith("```")) inCode = !inCode;
    const next = lines[index + 1];
    if (inCode || !line.includes("|") || !next || !TABLE_SEPARATOR.test(next)) {
      out.push(line);
      continue;
    }
    const table = [line, next];
    index += 2;
    while (index < lines.length && lines[index]?.includes("|")) table.push(lines[index++] ?? "");
    index--;
    out.push(renderTable(table));
  }
  return out.join("\n");
}

/**
 * Split text into chunks of at most `limit` characters, preferring line breaks. A code block
 * cut in two is closed at the end of one chunk and reopened at the start of the next.
 */
export function splitMessage(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let fence: string | null = null;
  const flush = () => {
    if (!current.trim()) return;
    chunks.push(fence ? `${current}\n\`\`\`` : current);
    current = fence ?? "";
  };
  for (const raw of text.split("\n")) {
    // A single line longer than a chunk is hard-wrapped.
    const pieces =
      raw.length > limit - 8 ? (raw.match(new RegExp(`.{1,${limit - 8}}`, "g")) ?? [raw]) : [raw];
    for (const line of pieces) {
      if (current && current.length + line.length + 5 > limit) flush();
      current = current ? `${current}\n${line}` : line;
      if (line.trimStart().startsWith("```")) fence = fence ? null : line.trimStart();
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}
