import { describe, expect, test } from "bun:test";
import { mapOpencodeRunStatus } from "./opencode";

describe("mapOpencodeRunStatus", () => {
  test("maps native transport state without claiming workflow success", () => {
    expect(mapOpencodeRunStatus({ type: "busy" })).toBe("running");
    expect(mapOpencodeRunStatus({ type: "retry", attempt: 1, message: "retry", next: 1 })).toBe(
      "retrying",
    );
    expect(mapOpencodeRunStatus({ type: "idle" })).toBe("completed");
    expect(mapOpencodeRunStatus(undefined, undefined, false)).toBe("running");
    expect(mapOpencodeRunStatus(undefined, undefined, false, true)).toBe("failed");
  });

  test("reports native assistant failures and cancellation", () => {
    expect(mapOpencodeRunStatus({ type: "idle" }, "ProviderAuthError")).toBe("failed");
    expect(mapOpencodeRunStatus({ type: "idle" }, "MessageAbortedError")).toBe("cancelled");
  });
});
