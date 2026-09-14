const REDACTED = "[REDACTED]";

function redactText(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (text, secret) => (secret ? text.replaceAll(secret, REDACTED) : text),
    value,
  );
}

export function redactSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (value instanceof Error) {
    const redacted = new Error(redactText(value.message, secrets));
    redacted.name = value.name;
    redacted.stack = value.stack ? redactText(value.stack, secrets) : undefined;
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]),
    );
  }
  return value;
}

/** Defense-in-depth for logs where the complete secret set is no longer available. */
export function redactSensitiveText(value: string, secrets: readonly string[] = []): string {
  return redactText(value, secrets)
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*)([^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|ya29\.[A-Za-z0-9._-]+|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
      REDACTED,
    );
}
