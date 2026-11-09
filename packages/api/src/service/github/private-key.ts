import { createPrivateKey } from "node:crypto";

/**
 * A GitHub App private key as PEM, from any of the ways it gets pasted: the downloaded .pem,
 * the same with escaped newlines, the whole file base64-encoded, or only the base64 body
 * without its BEGIN and END lines.
 */
export function decodePrivateKey(key: string): string {
  const text = key
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");
  if (text.includes("-----BEGIN")) return text;

  const bytes = Buffer.from(text.replace(/\s+/g, ""), "base64");
  const decoded = bytes.toString("utf-8");
  if (decoded.includes("-----BEGIN")) return decodePrivateKey(decoded);

  // A bare body is the key's DER: rebuild the PEM around it, whichever format it is.
  for (const type of ["pkcs1", "pkcs8"] as const) {
    try {
      return createPrivateKey({ key: bytes, format: "der", type })
        .export({ format: "pem", type: "pkcs1" })
        .toString();
    } catch {
      // Try the other format.
    }
  }
  throw new Error("Invalid GitHub App private key format");
}
