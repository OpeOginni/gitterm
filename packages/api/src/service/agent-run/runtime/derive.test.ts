import { describe, expect, test } from "bun:test";
import { deriveRunState, MISSING_ASSISTANT_GRACE_MS } from "./derive";
import type { RuntimeSnapshot } from "./types";

function snapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    sessionExists: true,
    busy: false,
    retry: false,
    messages: [],
    finalText: null,
    assistant: { exists: true, completed: true, error: null },
    pendingInputs: [],
    ...overrides,
  };
}

const permission = {
  id: "per_1",
  kind: "permission" as const,
  createdAt: "2026-09-04T00:00:00.000Z",
  toolCallId: "call_1",
  permission: "bash",
  patterns: ["echo hi"],
  always: ["echo *"],
  title: "bash: echo hi",
};

describe("deriveRunState", () => {
  const submittedAt = new Date("2026-09-04T00:00:00.000Z");

  test("a completed assistant turn in an idle session is completed", () => {
    expect(deriveRunState(snapshot(), { submittedAt })).toEqual({
      status: "completed",
      errorMessage: null,
    });
  });

  test("a pending permission or question wins over a busy session", () => {
    expect(
      deriveRunState(snapshot({ busy: true, pendingInputs: [permission] }), { submittedAt }),
    ).toEqual({ status: "awaiting_input", errorMessage: null });
  });

  test("busy and retry map to running and retrying", () => {
    expect(deriveRunState(snapshot({ busy: true }), { submittedAt }).status).toBe("running");
    expect(deriveRunState(snapshot({ busy: true, retry: true }), { submittedAt }).status).toBe(
      "retrying",
    );
  });

  test("an unfinished assistant message keeps the run running even when the session looks idle", () => {
    expect(
      deriveRunState(snapshot({ assistant: { exists: true, completed: false, error: null } }), {
        submittedAt,
      }).status,
    ).toBe("running");
  });

  test("aborted turns are cancelled, other assistant errors fail the run", () => {
    expect(
      deriveRunState(
        snapshot({
          assistant: {
            exists: true,
            completed: true,
            error: { kind: "aborted", message: "aborted" },
          },
        }),
        { submittedAt },
      ),
    ).toEqual({ status: "cancelled", errorMessage: "aborted" });
    expect(
      deriveRunState(
        snapshot({
          assistant: {
            exists: true,
            completed: true,
            error: { kind: "error", message: "Model provider credential rejected" },
          },
        }),
        { submittedAt },
      ),
    ).toEqual({ status: "failed", errorMessage: "Model provider credential rejected" });
  });

  test("a missing assistant is running inside the grace period and failed after it", () => {
    const missing = snapshot({ assistant: { exists: false, completed: false, error: null } });
    const now = submittedAt.getTime();
    expect(deriveRunState(missing, { submittedAt, now }).status).toBe("running");
    expect(deriveRunState(missing, { submittedAt, now: now + MISSING_ASSISTANT_GRACE_MS })).toEqual(
      {
        status: "failed",
        errorMessage: "OpenCode stopped before producing an assistant response",
      },
    );
    expect(
      deriveRunState(missing, { submittedAt, now, sessionError: "Provider unavailable" }),
    ).toEqual({ status: "failed", errorMessage: "Provider unavailable" });
  });

  test("a deleted session cancels the run", () => {
    expect(deriveRunState(snapshot({ sessionExists: false }), { submittedAt })).toEqual({
      status: "cancelled",
      errorMessage: "Session was deleted before the run completed",
    });
  });
});
