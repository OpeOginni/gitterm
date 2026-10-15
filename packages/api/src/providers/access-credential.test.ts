import { expect, test } from "bun:test";
import { captureAgentAccessCredential } from "./access-credential";

test("password agents never execute a pairing command", async () => {
  expect(
    await captureAgentAccessCredential(undefined, async () => {
      throw new Error("must not run");
    }),
  ).toBeUndefined();
});

test("pairing credentials are captured as opaque trimmed values", async () => {
  expect(
    await captureAgentAccessCredential("mint", async (command) => {
      expect(command).toBe("mint");
      return { exitCode: 0, stdout: "  secret-token\n" };
    }),
  ).toBe("secret-token");
});

test("failed or empty capture fails provisioning without leaking secrets", async () => {
  for (const execute of [
    async () => ({ exitCode: 1, stdout: "secret-token" }),
    async () => ({ exitCode: 0, stdout: " " }),
    async () => {
      throw new Error("secret-token");
    },
  ]) {
    await expect(captureAgentAccessCredential("mint", execute)).rejects.toThrow(
      "Failed to capture agent access credential",
    );
  }
});
