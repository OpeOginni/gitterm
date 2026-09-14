import { expect, test } from "bun:test";
import { AWS_STARTUP_TIMEOUT_MS, AWS_STARTUP_GRACE_SECONDS, isExpiredOrphan } from "./lifecycle";

test("startup keeps a three-minute budget and aligned grace", () => {
  expect(AWS_STARTUP_TIMEOUT_MS).toBe(180000);
  expect(AWS_STARTUP_GRACE_SECONDS).toBe(180);
});

test("cleanup protects in-flight and unknown-age resources", () => {
  const now = Date.now();
  expect(isExpiredOrphan(new Date(now - 180000).toISOString(), now)).toBe(false);
  expect(isExpiredOrphan(new Date(now - 660000).toISOString(), now)).toBe(true);
  expect(isExpiredOrphan(undefined, now)).toBe(false);
  expect(isExpiredOrphan("invalid", now)).toBe(false);
  expect(isExpiredOrphan(new Date(now + 100000).toISOString(), now)).toBe(false);
});
