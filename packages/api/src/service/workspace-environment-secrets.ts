import { encryptionContext, getEncryptionService } from "./encryption";

const STORAGE_VERSION = 1;
const REDACTED = "[REDACTED]";
const ENCRYPTION_CONTEXT = "gitterm:workspace-environment";

type EncryptedEnvironment = {
  version: typeof STORAGE_VERSION;
  ciphertext: string;
};

type EnvironmentIdentity = { id: string; userId: string; agentTypeId: string };

export function workspaceEnvironmentContext(row: EnvironmentIdentity): string {
  return encryptionContext("workspace-environment", row.userId, row.id, row.agentTypeId);
}

function isEncryptedEnvironment(value: unknown): value is EncryptedEnvironment {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<EncryptedEnvironment>).version === STORAGE_VERSION &&
    typeof (value as Partial<EncryptedEnvironment>).ciphertext === "string",
  );
}

function assertEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid stored workspace environment");
  }
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => key && typeof item === "string")) {
    throw new Error("Invalid stored workspace environment");
  }
  return Object.fromEntries(entries);
}

/** Encrypt the entire value map so names and values are both protected at rest. */
export function sealWorkspaceEnvironment(
  environment: Record<string, string>,
  identity: EnvironmentIdentity,
): EncryptedEnvironment {
  return {
    version: STORAGE_VERSION,
    ciphertext: getEncryptionService().encryptForRecord(
      JSON.stringify(environment),
      workspaceEnvironmentContext(identity),
      ENCRYPTION_CONTEXT,
    ),
  };
}

export function openWorkspaceEnvironment(
  stored: unknown,
  identity: EnvironmentIdentity,
): Record<string, string> {
  if (!isEncryptedEnvironment(stored)) throw new Error("Invalid encrypted workspace environment");
  const plaintext = getEncryptionService().decryptForRecord(
    stored.ciphertext,
    workspaceEnvironmentContext(identity),
    ENCRYPTION_CONTEXT,
  );
  return assertEnvironment(JSON.parse(plaintext));
}

/** API responses expose names for management, never stored values or ciphertext. */
export function maskWorkspaceEnvironment(
  stored: unknown,
  identity: EnvironmentIdentity,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(openWorkspaceEnvironment(stored, identity)).map((key) => [key, REDACTED]),
  );
}
