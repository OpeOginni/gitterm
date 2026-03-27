const ALLOWED_SSH_KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

export function normalizeSshPublicKey(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidSshPublicKey(value: string): boolean {
  const normalized = normalizeSshPublicKey(value);
  const parts = normalized.split(" ");

  if (parts.length < 2) {
    return false;
  }

  const keyType = parts[0];
  const keyBody = parts[1];

  if (!keyType || !keyBody || !ALLOWED_SSH_KEY_TYPES.has(keyType)) {
    return false;
  }

  return /^[A-Za-z0-9+/=]+$/.test(keyBody);
}
