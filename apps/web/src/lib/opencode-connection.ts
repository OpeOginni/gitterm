function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Quote credentials and addresses independently; neither may become shell syntax. */
export function opencodeAttachCommand(url: string, credential: string): string {
  return `OPENCODE_PASSWORD=${shellQuote(credential)} opencode --server ${shellQuote(url)}`;
}
