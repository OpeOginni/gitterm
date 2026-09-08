import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createRuntimeSecret, deleteRuntimeSecret } from "./runtime-secrets";
import type { AwsConfig } from "./types";

afterEach(() => mock.restore());
const config = {
  defaultRegion: "eu-central-1",
  accessKeyId: "test",
  secretAccessKey: "test",
} as AwsConfig;

test("stores secrets outside the task definition and includes ownership tags", async () => {
  const send = spyOn(SecretsManagerClient.prototype, "send").mockResolvedValue({
    ARN: "secret-arn",
  } as never);
  const result = await createRuntimeSecret(
    config,
    "workspace",
    { API_KEY: "sensitive", OMIT: undefined },
    "provider",
  );
  expect(result.secrets).toEqual([{ name: "API_KEY", valueFrom: "secret-arn:API_KEY::" }]);
  const input = (send.mock.calls[0]![0] as any).input;
  expect(JSON.parse(input.SecretString)).toEqual({ API_KEY: "sensitive" });
  expect(input.Tags).toContainEqual({ Key: "ProviderId", Value: "provider" });
});

test("rejects invalid keys and oversized payloads before calling AWS", async () => {
  const send = spyOn(SecretsManagerClient.prototype, "send");
  await expect(createRuntimeSecret(config, "workspace", { "KEY:BAD": "value" })).rejects.toThrow(
    "variable name",
  );
  await expect(
    createRuntimeSecret(config, "workspace", { DATA: "a".repeat(65536) }),
  ).rejects.toThrow("64 KiB");
  expect(send).not.toHaveBeenCalled();
});

test("deletion is idempotent only for missing secrets, not permission failures", async () => {
  const send = spyOn(SecretsManagerClient.prototype, "send").mockImplementation(async () => {
    throw Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
  });
  await deleteRuntimeSecret(config, "secret");
  send.mockImplementation(async () => {
    throw new Error("AccessDenied");
  });
  await expect(deleteRuntimeSecret(config, "secret")).rejects.toThrow("AccessDenied");
});
