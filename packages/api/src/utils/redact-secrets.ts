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
