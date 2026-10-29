import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import env from "@gitterm/env/server";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_KEY = "0".repeat(64);
const FORMAT_PREFIX = "v2:";
const RECORD_PREFIX = "v3:";
const DEFAULT_AAD = "gitterm:credential:v2";

export function encryptionContext(kind: string, ...identity: string[]): string {
  return JSON.stringify(["gitterm", "v3", kind, ...identity]);
}

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
  if (activeValue === DEFAULT_KEY && env.NODE_ENV !== "test") {
    if (env.NODE_ENV === "production" || !env.ENCRYPTION_ALLOW_INSECURE_DEV_KEY) {
      throw new Error(
        "Set ENCRYPTION_MASTER_KEY to a random 64-character hex key. Existing development data may need the old key retained; see docs/credential-security.md.",
      );
    }
    console.warn("Using the insecure development encryption key. Do not store real credentials.");
  }
  if (!activeId || activeId.includes(":")) throw new Error("Invalid ENCRYPTION_MASTER_KEY_ID");
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
      if (!id || id.includes(":") || typeof value !== "string")
        throw new Error("Invalid ENCRYPTION_MASTER_KEYS entry");
      const key = parseKey(value, `ENCRYPTION_MASTER_KEYS.${id}`);
      if (keys.has(id) && !keys.get(id)!.equals(key)) {
        throw new Error(
          "An encryption key ID identifies different keys. Use a new ENCRYPTION_MASTER_KEY_ID when rotating.",
        );
      }
      keys.set(id, key);
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
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce, { authTagLength: TAG_LENGTH });
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

  needsRewrap(value: string, recordBound = false): boolean {
    const prefix = value.startsWith(RECORD_PREFIX) ? RECORD_PREFIX : FORMAT_PREFIX;
    if (!value.startsWith(prefix)) return true;
    if (recordBound && env.ENCRYPTION_WRITE_VERSION === "v3" && prefix !== RECORD_PREFIX)
      return true;
    const separator = value.indexOf(":", prefix.length);
    return separator === -1 || value.slice(prefix.length, separator) !== this.activeId;
  }

  encrypt(plaintext: string, aad = DEFAULT_AAD): string {
    return this.encryptEnvelope(plaintext, aad, FORMAT_PREFIX);
  }

  encryptForRecord(plaintext: string, context: string, legacyContext = DEFAULT_AAD): string {
    return env.ENCRYPTION_WRITE_VERSION === "v3"
      ? this.encryptEnvelope(plaintext, context, RECORD_PREFIX)
      : this.encrypt(plaintext, legacyContext);
  }

  decryptForRecord(value: string, context: string, legacyContext = DEFAULT_AAD): string {
    return value.startsWith(RECORD_PREFIX)
      ? this.decryptEnvelope(value, context, RECORD_PREFIX)
      : this.decrypt(value, legacyContext);
  }

  private encryptEnvelope(plaintext: string, aad: string, prefix: string): string {
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
    return `${prefix}${this.activeId}:${Buffer.from(JSON.stringify(envelope)).toString("base64")}`;
  }

  decrypt(value: string, aad = DEFAULT_AAD): string {
    if (/^v\d+:/.test(value) && !value.startsWith(FORMAT_PREFIX)) {
      throw new Error("Encrypted value requires a supported record context");
    }
    if (!value.startsWith(FORMAT_PREFIX)) return this.decryptLegacy(value);
    return this.decryptEnvelope(value, aad, FORMAT_PREFIX);
  }

  private decryptEnvelope(value: string, aad: string, prefix: string): string {
    const separator = value.indexOf(":", prefix.length);
    if (separator === -1) throw new Error("Invalid encrypted value");
    const keyId = value.slice(prefix.length, separator);
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
        const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce, {
          authTagLength: TAG_LENGTH,
        });
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

  encryptCredential(credential: ApiKeyCredential | OAuthCredential, context: string): string {
    return this.encryptForRecord(JSON.stringify(credential), context);
  }

  decryptCredential(
    encryptedCredential: string,
    context: string,
  ): ApiKeyCredential | OAuthCredential {
    return JSON.parse(this.decryptForRecord(encryptedCredential, context));
  }

  static generateMasterKey(): string {
    return randomBytes(32).toString("hex");
  }
}

export interface ApiKeyCredential {
  type: "api_key";
  apiKey: string;
  /** Non-secret provider values, such as a Cloudflare account ID. */
  metadata?: Record<string, string>;
}

export interface OAuthCredential {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
  enterpriseUrl?: string;
  accountId?: string;
  /** OIDC identity token required by native Codex's ChatGPT auth store. Encrypted with the credential. */
  idToken?: string;
  /** Provider account details OpenCode keeps with the token, such as an OpenCode org. */
  metadata?: Record<string, string>;
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
