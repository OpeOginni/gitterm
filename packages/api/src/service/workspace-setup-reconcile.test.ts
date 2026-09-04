import { describe, expect, test } from "bun:test";
import { SETUP_STALL_AFTER_MS, stalledSetupReason } from "./workspace-setup-reconcile";

describe("stalledSetupReason", () => {
  const createdAt = new Date("2026-09-03T10:00:00Z");
  const late = new Date(createdAt.getTime() + SETUP_STALL_AFTER_MS + 1_000);
  const early = new Date(createdAt.getTime() + SETUP_STALL_AFTER_MS - 60_000);

  test("never fails inside the window", () => {
    expect(stalledSetupReason({ createdAt, now: early, state: "absent" })).toBeNull();
    expect(stalledSetupReason({ createdAt, now: early, state: "unreadable" })).toBeNull();
  });

  test("a long-running setup is not a stall", () => {
    expect(stalledSetupReason({ createdAt, now: late, state: "running" })).toBeNull();
  });

  test("explains why the setup stalled", () => {
    expect(stalledSetupReason({ createdAt, now: late, state: "absent" })).toContain(
      "never started",
    );
    expect(stalledSetupReason({ createdAt, now: late, state: "waiting" })).toContain(
      "WORKSPACE_SETUP_PORT",
    );
    expect(stalledSetupReason({ createdAt, now: late, state: "unreadable" })).toContain(
      "WORKSPACE_API_URL",
    );
  });
});
