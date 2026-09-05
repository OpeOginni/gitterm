import { describe, expect, test } from "bun:test";
import {
  findLastOpencodeRunAssistant,
  formatOpencodeError,
  isOpencodeRunMessage,
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
