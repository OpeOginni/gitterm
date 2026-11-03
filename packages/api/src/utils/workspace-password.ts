import { randomBytes } from "crypto";
import { encryptionContext, getEncryptionService } from "../service/encryption";

type WorkspaceIdentity = { id: string; userId: string };

export function workspacePasswordContext(identity: WorkspaceIdentity): string {
  return encryptionContext("workspace-password", identity.userId, identity.id);
}

/**
 * Utility for managing workspace server passwords.
 *
 * Server passwords are generated for workspaces that are serverOnly.
 * They are stored encrypted in the database and only decrypted:
 * 1. When passed to the workspace environment variables
 * 2. When returned to the workspace owner via API
 */

const PASSWORD_LENGTH = 32;

/**
 * Generate a secure random password for workspace authentication.
 * Uses 16 bytes of randomness encoded as hex (32 characters).
 */
export function generateWorkspacePassword(): string {
  return randomBytes(PASSWORD_LENGTH / 2).toString("hex");
}

/**
 * Encrypt a workspace password for storage in the database.
 */
export function encryptWorkspacePassword(password: string, identity: WorkspaceIdentity): string {
  const encryption = getEncryptionService();
  return encryption.encryptForRecord(password, workspacePasswordContext(identity));
}

/**
 * Decrypt a workspace password from the database.
 */
export function decryptWorkspacePassword(
  encryptedPassword: string,
  identity: WorkspaceIdentity,
): string {
  const encryption = getEncryptionService();
  return encryption.decryptForRecord(encryptedPassword, workspacePasswordContext(identity));
}

/**
 * Hash password prefix for audit logging.
 * Returns first 16 characters of SHA-256 hash.
 */
export function hashPasswordForAudit(password: string): string {
  const encryption = getEncryptionService();
  return encryption.hashForAudit(password);
}

/**
 * Generate and encrypt a password in one step.
 * Returns both the original password (for immediate use) and encrypted version (for storage).
 */
export function generateAndEncryptPassword(identity: WorkspaceIdentity): {
  password: string;
  encryptedPassword: string;
  passwordHash: string;
} {
  const password = generateWorkspacePassword();
  const encryptedPassword = encryptWorkspacePassword(password, identity);
  const passwordHash = hashPasswordForAudit(password);

  return {
    password,
    encryptedPassword,
    passwordHash,
  };
}
