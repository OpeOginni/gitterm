import { describe, expect, test } from "bun:test";
import {
  findLastOpencodeRunAssistant,
  formatOpencodeError,
  isOpencodeRunMessage,
  mapOpencodeRunStatus,
} from "./opencode";

describe("formatOpencodeError", () => {
  test("identifies the rejected model-provider credential", () => {
    expect(
      formatOpencodeError(
        { name: "APIError", data: { message: "Invalid API key." } },
        { providerID: "opencode", modelID: "big-pickle" },
      ),
    ).toBe(
      'Model provider credential "opencode" was rejected for model "opencode/big-pickle": Invalid API key.',
    );
  });
});

describe("mapOpencodeRunStatus", () => {
  test("maps native transport state without claiming workflow success", () => {
    expect(mapOpencodeRunStatus({ type: "busy" })).toBe("running");
    expect(mapOpencodeRunStatus({ type: "retry", attempt: 1, message: "retry", next: 1 })).toBe(
      "retrying",
    );
    expect(mapOpencodeRunStatus({ type: "idle" })).toBe("completed");
    expect(mapOpencodeRunStatus(undefined, undefined, false)).toBe("running");
    expect(mapOpencodeRunStatus(undefined, undefined, false, true)).toBe("failed");
    expect(mapOpencodeRunStatus({ type: "idle" }, undefined, true, false, false)).toBe("running");
  });

  test("reports native assistant failures and cancellation", () => {
    expect(mapOpencodeRunStatus({ type: "idle" }, "ProviderAuthError")).toBe("failed");
    expect(mapOpencodeRunStatus({ type: "idle" }, "MessageAbortedError")).toBe("cancelled");
  });
});

describe("isOpencodeRunMessage", () => {
  test("selects only the user prompt and its assistant response", () => {
    expect(isOpencodeRunMessage({ id: "prompt-1", role: "user" }, "prompt-1")).toBe(true);
    expect(
      isOpencodeRunMessage(
        { id: "assistant-1", role: "assistant", parentID: "prompt-1" },
        "prompt-1",
      ),
    ).toBe(true);
    expect(
      isOpencodeRunMessage(
        { id: "assistant-2", role: "assistant", parentID: "prompt-2" },
        "prompt-1",
      ),
    ).toBe(false);
  });

  test("uses the final assistant step for a run", () => {
    const messages = [
      { info: { id: "prompt-1", role: "user" as const } },
      { info: { id: "assistant-1", role: "assistant" as const, parentID: "prompt-1" } },
      { info: { id: "assistant-2", role: "assistant" as const, parentID: "prompt-1" } },
    ];

    expect(findLastOpencodeRunAssistant(messages, "prompt-1")?.info.id).toBe("assistant-2");
  });
});
