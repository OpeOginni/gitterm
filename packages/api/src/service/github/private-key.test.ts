import { describe, expect, test } from "bun:test";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { decodePrivateKey } from "./private-key";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
const pkcs8 = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const body = (pem: string) =>
  pem
    .split("\n")
    .filter((line) => line && !line.startsWith("-----"))
    .join("\n");
const sameKey = (pem: string) =>
  expect(createPrivateKey(pem).export({ format: "der", type: "pkcs1" })).toEqual(
    privateKey.export({ format: "der", type: "pkcs1" }),
  );

describe("decodePrivateKey", () => {
  test("keeps a pasted .pem as it is", () => {
    expect(decodePrivateKey(pkcs1)).toBe(pkcs1.trim());
    expect(decodePrivateKey(`\r\n${pkcs8.replace(/\n/g, "\r\n")}`)).toBe(pkcs8.trim());
  });

  test("reads escaped newlines and surrounding quotes", () => {
    sameKey(decodePrivateKey(`"${pkcs1.trim().replace(/\n/g, "\\n")}"`));
  });

  test("reads the whole file base64-encoded", () => {
    sameKey(decodePrivateKey(Buffer.from(pkcs1).toString("base64")));
  });

  test("adds the BEGIN and END lines to a bare body", () => {
    sameKey(decodePrivateKey(body(pkcs1)));
    sameKey(decodePrivateKey(body(pkcs8)));
    sameKey(decodePrivateKey(body(pkcs1).replace(/\n/g, "")));
  });

  test("rejects text that isn't a key", () => {
    expect(() => decodePrivateKey("not a key")).toThrow("Invalid GitHub App private key format");
  });
});
