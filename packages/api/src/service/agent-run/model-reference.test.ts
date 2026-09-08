import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { validateModelReference } from ".";

test("accepts models whose credentials may come from the runtime", () => {
  expect(() => validateModelReference("amazon-bedrock/eu.anthropic.claude-opus-4-8")).not.toThrow();
  expect(() => validateModelReference("future-workload-provider/model")).not.toThrow();
  expect(() => validateModelReference(undefined)).not.toThrow();
});

test.each(["amazon-bedrock", "/model", "provider/"])(
  "rejects malformed model reference %s",
  (model) => {
    const error = (() => {
      try {
        validateModelReference(model);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe("BAD_REQUEST");
    expect((error as Error).message).toContain("provider/model");
    expect((error as Error).message).not.toContain("CREDENTIAL");
  },
);
