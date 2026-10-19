import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { boatWebhookBoxId, boatWebhookSchema, verifyBoatWebhookSignature } from "./webhook";

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
      verifyBoatWebhookSignature(
        secret,
        body,
        { delivery: "evt_1", timestamp, signature: sign(body) },
        now,
      ),
    ).toBe(true);
  });

  test("rejects a changed body, a wrong secret, a malformed or stale signature", () => {
    const headers = { delivery: "evt_1", timestamp, signature: sign(body) };
    expect(verifyBoatWebhookSignature(secret, `${body} `, headers, now)).toBe(false);
    expect(
      verifyBoatWebhookSignature(
        secret,
        body,
        { ...headers, signature: sign(body, timestamp, "whsec_other") },
        now,
      ),
    ).toBe(false);
    expect(
      verifyBoatWebhookSignature(secret, body, { ...headers, signature: "v1=nothex" }, now),
    ).toBe(false);
    const old = String(Math.floor(now / 1000) - 301);
    expect(
      verifyBoatWebhookSignature(
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
      boatWebhookSchema.safeParse({ ...JSON.parse(body), createdAt: "not-a-date" }).success,
    ).toBe(false);
  });

  test("reads the box from either naming", () => {
    const sandbox = boatWebhookSchema.parse(JSON.parse(body));
    const box = boatWebhookSchema.parse({
      id: "evt_2",
      type: "box.error",
      createdAt: "2026-10-07T10:00:00.000Z",
      data: { box: { id: "bx_box", name: "w" }, previousState: "running", state: "error" },
    });
    expect(boatWebhookBoxId(sandbox)).toBe("bx_23456789");
    expect(boatWebhookBoxId(box)).toBe("bx_box");
  });
});

const parsesWithCreatedAt = (createdAt: string) =>
  boatWebhookSchema.safeParse({
    id: "evt_3",
    type: "sandbox.archived",
    createdAt,
    data: { sandbox: { id: "bx_1" } },
  }).success;

describe("boat webhook timestamps", () => {
  test("accepts offset and fractional timestamps, rejects non-dates", () => {
    const event = parsesWithCreatedAt;
    expect(event("2026-10-06T22:31:10.401Z")).toBe(true);
    expect(event("2026-10-06T22:31:10.401+00:00")).toBe(true);
    expect(event("2026-10-06T22:31:10.401123456Z")).toBe(true);
    expect(event("not a date")).toBe(false);
  });
});
