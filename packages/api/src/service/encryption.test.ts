import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { EncryptionService } from "./encryption";

const keyHex = "12".repeat(32);

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
});
