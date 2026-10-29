/** Merge native OpenCode 2 plugins without losing their options. */
export function buildOpencodeConfig(
  input: Record<string, unknown> | null | undefined,
  extraPlugins: string[] = [],
): Record<string, unknown> {
  const config = { ...input };
  const configured = Array.isArray(config.plugins) ? config.plugins : [];
  const names = new Set(
    configured.map((entry) => (typeof entry === "string" ? entry : entry?.package)),
  );
  const plugins = [...configured, ...extraPlugins.filter((name) => !names.has(name))];
  delete config.theme;
  return {
    $schema: "https://opencode.ai/config.json",
    ...config,
    ...(plugins.length ? { plugins } : {}),
  };
}

export function buildOpencodeCliConfig(input: Record<string, unknown> | null | undefined) {
  return {
    $schema: "https://opencode.ai/v2/cli.json",
    theme: { name: typeof input?.theme === "string" ? input.theme : "opencode" },
  };
}
