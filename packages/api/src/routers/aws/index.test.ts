import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { providerConfig } from "@gitterm/db/schema/provider-config";
import { awsRouter } from ".";
import * as setup from "../../providers/aws/setup";
import * as reconcile from "../../providers/aws/reconcile";
import * as iam from "../../providers/aws/iam";
import { getProviderConfigService } from "../../service/config/provider-config";

const providerId = "11111111-1111-4111-8111-111111111111";
const configId = "22222222-2222-4222-8222-222222222222";
const savedConfig = {
  accessKeyId: "test",
  secretAccessKey: "test",
  defaultRegion: "eu-central-1",
  taskRoleArn: "arn:aws:iam::123456789012:role/team/PresentationRole",
};
const caller = () => awsRouter.createCaller({ session: { user: { role: "admin" } } } as any);
let deleted: unknown[];
let updated: Array<{ table: unknown; values: any }>;

beforeEach(() => {
  deleted = [];
  updated = [];
  spyOn(db.query.cloudProvider, "findFirst").mockResolvedValue({
    id: providerId,
    providerKey: "aws",
    providerConfigId: configId,
  } as any);
  spyOn(db.query.providerType, "findFirst").mockResolvedValue({ id: "aws-type" } as any);
  spyOn(db.query.region, "findFirst").mockResolvedValue({
    externalRegionIdentifier: savedConfig.defaultRegion,
  } as any);
  spyOn(db, "$count").mockImplementation(() => Promise.resolve(0) as any);
  spyOn(getProviderConfigService(), "getProviderConfigById").mockResolvedValue({
    id: configId,
    updatedAt: new Date("2026-09-05T10:00:00Z"),
    config: savedConfig,
  } as any);
  spyOn(reconcile, "runAwsCleanupSweep").mockResolvedValue({ unresolvedCleanupCount: 0 } as any);
  spyOn(setup, "deleteAwsProviderInfrastructure").mockResolvedValue({
    deleted: true,
    stackName: "gitterm-eu-central-1",
  });
  spyOn(db, "transaction").mockImplementation(async (callback: any) =>
    callback({
      delete(table: unknown) {
        deleted.push(table);
        return { where: async () => {} };
      },
      update(table: unknown) {
        return {
          set(values: any) {
            updated.push({ table, values });
            return { where: async () => {} };
          },
        };
      },
    }),
  );
});
afterEach(() => mock.restore());

test("reset preserves provider/config records and disables config until bootstrap succeeds", async () => {
  const result = await caller().deleteInfrastructure({ providerId, preserveProvider: true });
  expect(deleted).toEqual([]);
  expect(updated).toHaveLength(1);
  expect(updated[0]?.table).toBe(providerConfig);
  expect(updated[0]?.values.isEnabled).toBe(false);
  expect(result.deletedProviderId).toBeNull();
});

test("normal deletion still removes provider and credentials", async () => {
  const result = await caller().deleteInfrastructure({ providerId });
  expect(deleted).toEqual([cloudProvider, providerConfig]);
  expect(result.deletedProviderId).toBe(providerId);
});

test("failed AWS deletion does not remove database records", async () => {
  spyOn(setup, "deleteAwsProviderInfrastructure").mockRejectedValue(new Error("AccessDenied"));
  await expect(caller().deleteInfrastructure({ providerId })).rejects.toThrow("AccessDenied");
  expect(deleted).toEqual([]);
  expect(updated).toEqual([]);
});

test.each([undefined, "CustomRole", ""])(
  "bootstrap preserves or explicitly replaces the role (%s)",
  async (taskRoleName) => {
    const bootstrap = spyOn(setup, "bootstrapAwsProvider").mockRejectedValue(
      new Error("stop before provisioning"),
    );
    await expect(caller().bootstrap({ providerId, taskRoleName })).rejects.toThrow(
      "stop before provisioning",
    );
    expect(bootstrap.mock.calls[0]?.[0].taskRoleName).toBe(taskRoleName ?? "PresentationRole");
    expect(bootstrap.mock.calls[0]?.[0].defaultRegion).toBe("eu-central-1");
  },
);

test("invalid task role names are rejected before provisioning", async () => {
  const bootstrap = spyOn(setup, "bootstrapAwsProvider");
  await expect(caller().bootstrap({ providerId, taskRoleName: "role/invalid" })).rejects.toThrow();
  expect(bootstrap).not.toHaveBeenCalled();
});

test("non-admin sessions cannot bootstrap AWS roles", async () => {
  const bootstrap = spyOn(setup, "bootstrapAwsProvider");
  const userCaller = awsRouter.createCaller({ session: { user: { role: "user" } } } as any);
  await expect(userCaller.bootstrap({ providerId, taskRoleName: "CustomRole" })).rejects.toThrow(
    "Admin access required",
  );
  expect(bootstrap).not.toHaveBeenCalled();
});

test("admin can add an imported role for all users without a user allowlist", async () => {
  const check = {
    roleArn: savedConfig.taskRoleArn,
    discovery: "missing" as const,
    missingActions: ["iam:GetPolicy"],
    warnings: ["Review discovery"],
    recommendedPolicy: iam.buildRoleDiscoveryPolicy(savedConfig.taskRoleArn),
  };
  const prepare = spyOn(iam, "prepareAwsTaskRole").mockResolvedValue(check);
  const update = spyOn(getProviderConfigService(), "updateProviderConfig").mockResolvedValue({
    id: configId,
  } as any);
  const result = await caller().addAccessProfile({
    providerId,
    name: "Read development",
    description: "Development only",
    role: { mode: "existing", arn: savedConfig.taskRoleArn },
  });
  expect(result.profile.name).toBe("Read development");
  expect(result.profile.roleArn).toBe(savedConfig.taskRoleArn);
  expect(result.check.discovery).toBe("missing");
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0]?.[1].config?.accessProfiles).toEqual([result.profile]);
  expect(update.mock.calls[0]?.[2]).toEqual(new Date("2026-09-05T10:00:00Z"));
  expect("users" in result.profile).toBe(false);
});

test("role validation failure never adds an access profile", async () => {
  spyOn(iam, "prepareAwsTaskRole").mockRejectedValue(
    new Error("Task role must belong to this provider's AWS account"),
  );
  const update = spyOn(getProviderConfigService(), "updateProviderConfig");
  await expect(
    caller().addAccessProfile({
      providerId,
      name: "Invalid",
      role: { mode: "existing", arn: savedConfig.taskRoleArn },
    }),
  ).rejects.toThrow("provider's AWS account");
  expect(update).not.toHaveBeenCalled();
});

test("removing a profile only updates selections, not IAM or existing workspaces", async () => {
  const profile = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Read-only",
    description: "",
    roleArn: savedConfig.taskRoleArn,
  };
  spyOn(getProviderConfigService(), "getProviderConfigById").mockResolvedValue({
    id: configId,
    updatedAt: new Date(),
    config: { ...savedConfig, accessProfiles: [profile] },
  } as any);
  const update = spyOn(getProviderConfigService(), "updateProviderConfig").mockResolvedValue({
    id: configId,
  } as any);
  const prepare = spyOn(iam, "prepareAwsTaskRole");
  await caller().removeAccessProfile({ providerId, profileId: profile.id });
  expect(update.mock.calls[0]?.[1].config?.accessProfiles).toEqual([]);
  expect(prepare).not.toHaveBeenCalled();
  expect(deleted).toEqual([]);
});

test("role profile management and permission checks remain admin-only", async () => {
  const userCaller = awsRouter.createCaller({ session: { user: { role: "user" } } } as any);
  const prepare = spyOn(iam, "prepareAwsTaskRole");
  await expect(
    userCaller.addAccessProfile({
      providerId,
      name: "Unauthorized",
      role: { mode: "create", name: "AdminRole" },
    }),
  ).rejects.toThrow("Admin access required");
  await expect(userCaller.checkAccessRole({ providerId })).rejects.toThrow("Admin access required");
  await expect(
    userCaller.removeAccessProfile({
      providerId,
      profileId: "33333333-3333-4333-8333-333333333333",
    }),
  ).rejects.toThrow("Admin access required");
  expect(prepare).not.toHaveBeenCalled();
});
