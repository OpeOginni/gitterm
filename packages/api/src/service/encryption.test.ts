import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { EncryptionService, encryptionContext } from "./encryption";
import env from "@gitterm/env/server";

const keyHex = "12".repeat(32);
const writeVersion = env.ENCRYPTION_WRITE_VERSION;
afterEach(() => {
  env.ENCRYPTION_WRITE_VERSION = writeVersion;
});

function legacyEncrypt(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString("base64");
}

describe("EncryptionService", () => {
  test("uses versioned envelope encryption and authenticated context", () => {
    const encryption = new EncryptionService(keyHex);
    const encrypted = encryption.encrypt("secret", "record:user:one");
    expect(encrypted).toStartWith("v2:explicit:");
    expect(encrypted).not.toContain("secret");
    expect(encryption.needsRewrap(encrypted)).toBe(false);
    expect(encryption.decrypt(encrypted, "record:user:one")).toBe("secret");
    expect(() => encryption.decrypt(encrypted, "record:user:two")).toThrow("Decryption failed");
  });

  test("continues to decrypt legacy AES-GCM values", () => {
    const encryption = new EncryptionService(keyHex);
    const encrypted = legacyEncrypt("legacy");
    expect(encryption.needsRewrap(encrypted)).toBe(true);
    expect(encryption.decrypt(encrypted)).toBe("legacy");
  });

  test("stages record-bound writes while reading legacy, v2 and v3 without context fallback", () => {
    const encryption = new EncryptionService(keyHex);
    const context = encryptionContext("model-credential", "user", "record", "provider");
    env.ENCRYPTION_WRITE_VERSION = "v2";
    const previous = encryption.encryptForRecord("secret", context);
    expect(previous).toStartWith("v2:");
    env.ENCRYPTION_WRITE_VERSION = "v3";
    expect(encryption.decryptForRecord(previous, context)).toBe("secret");
    expect(encryption.decryptForRecord(legacyEncrypt("legacy"), context)).toBe("legacy");
    expect(encryption.needsRewrap(previous, true)).toBe(true);
    const bound = encryption.encryptForRecord("secret", context);
    expect(bound).toStartWith("v3:");
    expect(encryption.needsRewrap(bound, true)).toBe(false);
    expect(encryption.decryptForRecord(bound, context)).toBe("secret");
    for (const identity of [
      ["other-user", "record", "provider"],
      ["user", "other-record", "provider"],
      ["user", "record", "other-provider"],
    ]) {
      expect(() =>
        encryption.decryptForRecord(bound, encryptionContext("model-credential", ...identity)),
      ).toThrow("Decryption failed");
    }
    expect(() => encryption.decrypt(bound)).toThrow("record context");
    env.ENCRYPTION_WRITE_VERSION = "v2";
    expect(encryption.decryptForRecord(bound, context)).toBe("secret");
  });

  test("rejects shortened GCM tags and modified ciphertext", () => {
    const encryption = new EncryptionService(keyHex);
    const value = encryption.encrypt("secret");
    const prefix = "v2:explicit:";
    const original = JSON.parse(Buffer.from(value.slice(prefix.length), "base64").toString());
    for (const field of ["tag", "keyTag"] as const) {
      const tampered = {
        ...original,
        [field]: Buffer.from(original[field], "base64").subarray(0, 4).toString("base64"),
      };
      expect(() =>
        encryption.decrypt(prefix + Buffer.from(JSON.stringify(tampered)).toString("base64")),
      ).toThrow("Decryption failed");
    }
    const ciphertext = Buffer.from(original.ciphertext, "base64");
    ciphertext[0] = ciphertext[0]! ^ 1;
    const tampered = { ...original, ciphertext: ciphertext.toString("base64") };
    expect(() =>
      encryption.decrypt(prefix + Buffer.from(JSON.stringify(tampered)).toString("base64")),
    ).toThrow("Decryption failed");
  });

  test("requires an explicit development key and recovers old zero-key data through the keyring", () => {
    const previous = {
      NODE_ENV: env.NODE_ENV,
      ENCRYPTION_MASTER_KEY: env.ENCRYPTION_MASTER_KEY,
      ENCRYPTION_MASTER_KEY_ID: env.ENCRYPTION_MASTER_KEY_ID,
      ENCRYPTION_MASTER_KEYS: env.ENCRYPTION_MASTER_KEYS,
      ENCRYPTION_ALLOW_INSECURE_DEV_KEY: env.ENCRYPTION_ALLOW_INSECURE_DEV_KEY,
    };
    try {
      Object.assign(env, {
        NODE_ENV: "test",
        ENCRYPTION_MASTER_KEY: undefined,
        ENCRYPTION_MASTER_KEY_ID: "primary",
        ENCRYPTION_MASTER_KEYS: undefined,
        ENCRYPTION_ALLOW_INSECURE_DEV_KEY: false,
      });
      const old = new EncryptionService().encrypt("old-development-data");
      env.NODE_ENV = "development";
      expect(() => new EncryptionService()).toThrow("Set ENCRYPTION_MASTER_KEY");
      env.NODE_ENV = "production";
      env.ENCRYPTION_ALLOW_INSECURE_DEV_KEY = true;
      expect(() => new EncryptionService()).toThrow("Set ENCRYPTION_MASTER_KEY");
      env.ENCRYPTION_MASTER_KEY = keyHex;
      env.ENCRYPTION_MASTER_KEY_ID = "next";
      env.ENCRYPTION_MASTER_KEYS = JSON.stringify({ primary: "0".repeat(64) });
      const recovered = new EncryptionService();
      expect(recovered.decrypt(old)).toBe("old-development-data");
      expect(recovered.needsRewrap(old)).toBe(true);
      env.ENCRYPTION_MASTER_KEYS = JSON.stringify({ next: "34".repeat(32) });
      expect(() => new EncryptionService()).toThrow("different keys");
    } finally {
      Object.assign(env, previous);
    }
  });
});
