import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { asciiWebhookBoxId, asciiWebhookSchema, verifyAsciiWebhookSignature } from "./webhook";

const secret = "whsec_test";
const body = JSON.stringify({
  id: "evt_1",
  type: "sandbox.archived",
  createdAt: "2026-10-07T10:00:00.000Z",
  data: { sandbox: { id: "bx_23456789", name: "w" }, previousState: "running", state: "archived" },
});
const now = Date.parse("2026-10-07T10:00:05.000Z");
const timestamp = String(Math.floor(now / 1000));
// As in boat's docs: HMAC_SHA256(secret, delivery + "." + timestamp + "." + raw_body).
const sign = (payload: string, at = timestamp, key = secret) =>
  `v1=${createHmac("sha256", key).update(`evt_1.${at}.${payload}`).digest("hex")}`;

describe("boat webhook signatures", () => {
  test("accepts boat's signature over the raw body", () => {
    expect(
      verifyAsciiWebhookSignature(
        secret,
        body,
        { delivery: "evt_1", timestamp, signature: sign(body) },
        now,
      ),
    ).toBe(true);
  });

  test("rejects a changed body, a wrong secret, a malformed or stale signature", () => {
    const headers = { delivery: "evt_1", timestamp, signature: sign(body) };
    expect(verifyAsciiWebhookSignature(secret, `${body} `, headers, now)).toBe(false);
    expect(
      verifyAsciiWebhookSignature(
        secret,
        body,
        { ...headers, signature: sign(body, timestamp, "whsec_other") },
        now,
      ),
    ).toBe(false);
    expect(
      verifyAsciiWebhookSignature(secret, body, { ...headers, signature: "v1=nothex" }, now),
    ).toBe(false);
    const old = String(Math.floor(now / 1000) - 301);
    expect(
      verifyAsciiWebhookSignature(
        secret,
        body,
        { delivery: "evt_1", timestamp: old, signature: sign(body, old) },
        now,
      ),
    ).toBe(false);
  });
});

describe("boat webhook payloads", () => {
  test("rejects invalid event timestamps before updating workspace state", () => {
    expect(
      asciiWebhookSchema.safeParse({ ...JSON.parse(body), createdAt: "not-a-date" }).success,
    ).toBe(false);
  });

  test("reads the box from either naming", () => {
    const sandbox = asciiWebhookSchema.parse(JSON.parse(body));
    const box = asciiWebhookSchema.parse({
      id: "evt_2",
      type: "box.error",
      createdAt: "2026-10-07T10:00:00.000Z",
      data: { box: { id: "bx_box", name: "w" }, previousState: "running", state: "error" },
    });
    expect(asciiWebhookBoxId(sandbox)).toBe("bx_23456789");
    expect(asciiWebhookBoxId(box)).toBe("bx_box");
  });
});
