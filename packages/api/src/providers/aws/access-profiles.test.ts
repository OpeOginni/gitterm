import { expect, test } from "bun:test";
import { getAwsAccessProfiles, resolveAwsWorkspaceRole } from "./access-profiles";
import { getProviderConfigService } from "../../service/config/provider-config";

const profile = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Read-only",
  description: "Read development resources",
  roleArn: "arn:aws:iam::123456789012:role/WorkspaceReadOnly",
};
const config = { taskRoleArn: "arn:aws:iam::123456789012:role/Default", accessProfiles: [profile] };

test("profiles default to an empty list for legacy providers", () => {
  expect(getAwsAccessProfiles({})).toEqual([]);
  expect(resolveAwsWorkspaceRole(config)).toBe(config.taskRoleArn);
});

test("resolves only profiles from the selected provider", () => {
  expect(resolveAwsWorkspaceRole(config, profile.id)).toBe(profile.roleArn);
  expect(() => resolveAwsWorkspaceRole({ taskRoleArn: config.taskRoleArn }, profile.id)).toThrow(
    "not available for this provider",
  );
  expect(() => resolveAwsWorkspaceRole(config, "44444444-4444-4444-8444-444444444444")).toThrow();
  expect(() => resolveAwsWorkspaceRole(config, profile.roleArn)).toThrow();
});

test("structured access profiles persist as metadata, not credentials or discarded fields", () => {
  const service = getProviderConfigService() as any;
  const separated = service.separateConfigFields("aws", {
    ...config,
    accessKeyId: "secret-key",
    secretAccessKey: "secret",
    unknown: "discard",
  });
  expect(separated.metadata.accessProfiles).toEqual([profile]);
  expect(separated.metadata.taskRoleArn).toBe(config.taskRoleArn);
  expect(separated.encrypted).toEqual({ accessKeyId: "secret-key", secretAccessKey: "secret" });
  expect(separated.metadata.accessKeyId).toBeUndefined();
  expect(separated.metadata.unknown).toBeUndefined();
  const merged = service.mergeConfigPreservingEncryptedFields(
    "aws",
    { ...config },
    { taskRoleArn: "new-default-role" },
  );
  expect(merged.accessProfiles).toEqual([profile]);
});
