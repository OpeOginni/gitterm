import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import env from "@gitterm/env/server";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

// Default key for development - MUST be overridden in production
const DEFAULT_KEY = "0".repeat(64); // 32 bytes in hex

/**
 * Encryption Service for securing API keys and OAuth tokens at rest.
 *
 * Uses AES-256-GCM for authenticated encryption.
 * Format: nonce (12 bytes) || ciphertext || auth_tag (16 bytes)
 * Output is base64 encoded for storage in text columns.
 */
export class EncryptionService {
  private masterKey: Buffer;

  constructor(masterKeyHex?: string) {
    const keyHex = masterKeyHex || env.ENCRYPTION_MASTER_KEY || DEFAULT_KEY;

    if (keyHex === DEFAULT_KEY && env.NODE_ENV === "production") {
      console.warn(
        "WARNING: Using default encryption key in production. Set ENCRYPTION_MASTER_KEY environment variable.",
      );
    }

    this.masterKey = Buffer.from(keyHex, "hex");

    if (this.masterKey.length !== 32) {
      throw new Error("ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)");
    }
  }

  /**
   * Encrypt plaintext and return base64 encoded ciphertext.
   *
   * @param plaintext - The string to encrypt (e.g., API key or JSON tokens)
   * @returns Base64 encoded encrypted data
   */
  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, nonce);

    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    const tag = cipher.getAuthTag();

    // Combine: nonce || ciphertext || tag
    const combined = Buffer.concat([nonce, encrypted, tag]);

    return combined.toString("base64");
  }

  /**
   * Decrypt base64 encoded ciphertext and return plaintext.
   *
   * @param ciphertext - Base64 encoded encrypted data
   * @returns Decrypted plaintext string
   * @throws Error if decryption fails (wrong key, tampered data, etc.)
   */
  decrypt(ciphertext: string): string {
    const combined = Buffer.from(ciphertext, "base64");

    if (combined.length < NONCE_LENGTH + TAG_LENGTH) {
      throw new Error("Invalid ciphertext: too short");
    }

    const nonce = combined.subarray(0, NONCE_LENGTH);
    const tag = combined.subarray(-TAG_LENGTH);
    const encrypted = combined.subarray(NONCE_LENGTH, -TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, nonce);
    decipher.setAuthTag(tag);

    try {
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      throw new Error("Decryption failed: invalid key or tampered data");
    }
  }

  /**
   * Generate a hash prefix for audit logging.
   * Returns first 16 characters of SHA-256 hash.
   *
   * @param value - The value to hash (e.g., API key)
   * @returns First 16 chars of hex-encoded SHA-256 hash
   */
  hashForAudit(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  /**
   * Encrypt a credential object (API key or OAuth tokens).
   *
   * @param credential - Object containing apiKey or OAuth tokens
   * @returns Base64 encoded encrypted JSON
   */
  encryptCredential(credential: ApiKeyCredential | OAuthCredential): string {
    return this.encrypt(JSON.stringify(credential));
  }

  /**
   * Decrypt a credential object.
   *
   * @param encryptedCredential - Base64 encoded encrypted JSON
   * @returns Decrypted credential object
   */
  decryptCredential(encryptedCredential: string): ApiKeyCredential | OAuthCredential {
    const json = this.decrypt(encryptedCredential);
    return JSON.parse(json);
  }

  /**
   * Encrypt a credential for transmission to a sandbox.
   * Uses a separate session key for the sandbox.
   *
   * @param credential - The decrypted credential
   * @param sessionKey - 32-byte session key for this sandbox run
   * @returns Base64 encoded encrypted payload
   */
  encryptForSandbox(credential: ApiKeyCredential | OAuthCredential, sessionKey: Buffer): string {
    if (sessionKey.length !== 32) {
      throw new Error("Session key must be 32 bytes");
    }

    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, sessionKey, nonce);

    const plaintext = JSON.stringify(credential);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const combined = Buffer.concat([nonce, encrypted, tag]);
    return combined.toString("base64");
  }

  /**
   * Generate a random session key for sandbox encryption.
   *
   * @returns 32-byte random key
   */
  static generateSessionKey(): Buffer {
    return randomBytes(32);
  }

  /**
   * Generate a random encryption master key.
   * Use this to generate a new ENCRYPTION_MASTER_KEY value.
   *
   * @returns 64-character hex string (32 bytes)
   */
  static generateMasterKey(): string {
    return randomBytes(32).toString("hex");
  }
}

/**
 * API Key credential format
 */
export interface ApiKeyCredential {
  type: "api_key";
  apiKey: string;
}

/**
 * OAuth credential format (for GitHub Copilot, OpenAI Codex, etc.)
 */
export interface OAuthCredential {
  type: "oauth";
  refresh: string; // Long-lived refresh token (GitHub OAuth token)
  access?: string; // Short-lived access token (Copilot API token)
  expires?: number; // Expiry timestamp in milliseconds
  enterpriseUrl?: string; // For GitHub Enterprise
  accountId?: string; // For OpenAI Codex (ChatGPT account ID for organization subscriptions)
}

// Singleton instance
let encryptionService: EncryptionService | null = null;

/**
 * Get the singleton encryption service instance.
 */
export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    encryptionService = new EncryptionService();
  }
  return encryptionService;
}

export const encryption = {
  getService: getEncryptionService,
  generateMasterKey: EncryptionService.generateMasterKey,
  generateSessionKey: EncryptionService.generateSessionKey,
};
