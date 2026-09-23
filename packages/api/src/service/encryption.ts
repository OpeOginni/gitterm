import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import env from "@gitterm/env/server";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_KEY = "0".repeat(64);
const FORMAT_PREFIX = "v2:";
const DEFAULT_AAD = "gitterm:credential:v2";

type Envelope = {
  nonce: string;
  ciphertext: string;
  tag: string;
  keyNonce: string;
  encryptedKey: string;
  keyTag: string;
};

function parseKey(value: string, name: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be 32 bytes (64 hex characters)`);
  }
  return Buffer.from(value, "hex");
}

function configuredKeyring(masterKeyHex?: string): { activeId: string; keys: Map<string, Buffer> } {
  const activeId = masterKeyHex ? "explicit" : env.ENCRYPTION_MASTER_KEY_ID;
  const activeValue = masterKeyHex || env.ENCRYPTION_MASTER_KEY || DEFAULT_KEY;
  if (activeValue === DEFAULT_KEY && env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_MASTER_KEY is required in production");
  }
  const keys = new Map<string, Buffer>([
    [activeId, parseKey(activeValue, "ENCRYPTION_MASTER_KEY")],
  ]);
  if (!masterKeyHex && env.ENCRYPTION_MASTER_KEYS) {
    let previous: unknown;
    try {
      previous = JSON.parse(env.ENCRYPTION_MASTER_KEYS);
    } catch {
      throw new Error("ENCRYPTION_MASTER_KEYS must be a JSON object");
    }
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
      throw new Error("ENCRYPTION_MASTER_KEYS must be a JSON object");
    }
    for (const [id, value] of Object.entries(previous)) {
      if (!id || typeof value !== "string") throw new Error("Invalid ENCRYPTION_MASTER_KEYS entry");
      if (!keys.has(id)) keys.set(id, parseKey(value, `ENCRYPTION_MASTER_KEYS.${id}`));
    }
  }
  return { activeId, keys };
}

function encryptAes(plaintext: Buffer, key: Buffer, aad: string) {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

function decryptAes(
  encrypted: { nonce: Buffer; ciphertext: Buffer; tag: Buffer },
  key: Buffer,
  aad: string,
): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
}

/** Versioned envelope encryption with a random data key per value. */
export class EncryptionService {
  private readonly activeId: string;
  private readonly keys: Map<string, Buffer>;

  constructor(masterKeyHex?: string) {
    const keyring = configuredKeyring(masterKeyHex);
    this.activeId = keyring.activeId;
    this.keys = keyring.keys;
  }

  needsRewrap(value: string): boolean {
    if (!value.startsWith(FORMAT_PREFIX)) return true;
    const separator = value.indexOf(":", FORMAT_PREFIX.length);
    return separator === -1 || value.slice(FORMAT_PREFIX.length, separator) !== this.activeId;
  }

  encrypt(plaintext: string, aad = DEFAULT_AAD): string {
    const masterKey = this.keys.get(this.activeId)!;
    const dataKey = randomBytes(32);
    const value = encryptAes(Buffer.from(plaintext, "utf8"), dataKey, aad);
    const wrappedKey = encryptAes(dataKey, masterKey, `gitterm:keywrap:${this.activeId}`);
    const envelope: Envelope = {
      nonce: value.nonce.toString("base64"),
      ciphertext: value.ciphertext.toString("base64"),
      tag: value.tag.toString("base64"),
      keyNonce: wrappedKey.nonce.toString("base64"),
      encryptedKey: wrappedKey.ciphertext.toString("base64"),
      keyTag: wrappedKey.tag.toString("base64"),
    };
    return `${FORMAT_PREFIX}${this.activeId}:${Buffer.from(JSON.stringify(envelope)).toString("base64")}`;
  }

  decrypt(value: string, aad = DEFAULT_AAD): string {
    if (!value.startsWith(FORMAT_PREFIX)) return this.decryptLegacy(value);
    const separator = value.indexOf(":", FORMAT_PREFIX.length);
    if (separator === -1) throw new Error("Invalid encrypted value");
    const keyId = value.slice(FORMAT_PREFIX.length, separator);
    const masterKey = this.keys.get(keyId);
    if (!masterKey) throw new Error(`Encryption key ${keyId} is unavailable`);
    try {
      const envelope = JSON.parse(
        Buffer.from(value.slice(separator + 1), "base64").toString("utf8"),
      ) as Envelope;
      const dataKey = decryptAes(
        {
          nonce: Buffer.from(envelope.keyNonce, "base64"),
          ciphertext: Buffer.from(envelope.encryptedKey, "base64"),
          tag: Buffer.from(envelope.keyTag, "base64"),
        },
        masterKey,
        `gitterm:keywrap:${keyId}`,
      );
      return decryptAes(
        {
          nonce: Buffer.from(envelope.nonce, "base64"),
          ciphertext: Buffer.from(envelope.ciphertext, "base64"),
          tag: Buffer.from(envelope.tag, "base64"),
        },
        dataKey,
        aad,
      ).toString("utf8");
    } catch (error) {
      throw new Error("Decryption failed: invalid key, context, or tampered data", {
        cause: error,
      });
    }
  }

  private decryptLegacy(value: string): string {
    const combined = Buffer.from(value, "base64");
    if (combined.length < NONCE_LENGTH + TAG_LENGTH)
      throw new Error("Invalid ciphertext: too short");
    const encrypted = {
      nonce: combined.subarray(0, NONCE_LENGTH),
      ciphertext: combined.subarray(NONCE_LENGTH, -TAG_LENGTH),
      tag: combined.subarray(-TAG_LENGTH),
    };
    for (const key of this.keys.values()) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
        decipher.setAuthTag(encrypted.tag);
        return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString(
          "utf8",
        );
      } catch {}
    }
    throw new Error("Decryption failed: invalid key or tampered data");
  }

  hashForAudit(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
  }

  encryptCredential(credential: ApiKeyCredential | OAuthCredential): string {
    return this.encrypt(JSON.stringify(credential));
  }

  decryptCredential(encryptedCredential: string): ApiKeyCredential | OAuthCredential {
    return JSON.parse(this.decrypt(encryptedCredential));
  }

  static generateMasterKey(): string {
    return randomBytes(32).toString("hex");
  }
}

export interface ApiKeyCredential {
  type: "api_key";
  apiKey: string;
}

export interface OAuthCredential {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
  enterpriseUrl?: string;
  accountId?: string;
}

let encryptionService: EncryptionService | null = null;
export function getEncryptionService(): EncryptionService {
  encryptionService ??= new EncryptionService();
  return encryptionService;
}

export const encryption = {
  getService: getEncryptionService,
  generateMasterKey: EncryptionService.generateMasterKey,
};
