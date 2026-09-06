import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import { AwsProvider } from ".";
import { getProviderConfigService } from "../../service/config/provider-config";

afterEach(() => mock.restore());

test("region resolution refuses to fall back to another region's resources", async () => {
  spyOn(db.query.cloudProvider, "findMany").mockResolvedValue([]);
  spyOn(getProviderConfigService(), "getProviderConfigForUse").mockResolvedValue({
    accessKeyId: "test",
    secretAccessKey: "test",
    defaultRegion: "us-east-1",
  });
  await expect(new AwsProvider().getConfig("eu-central-1")).rejects.toThrow(
    "Refusing to use us-east-1 infrastructure",
  );
});

test("disabled region config cannot fall through to another enabled config", async () => {
  spyOn(db.query.cloudProvider, "findMany").mockResolvedValue([
    { providerConfigId: "config", regions: [{ externalRegionIdentifier: "eu-central-1" }] },
  ] as any);
  spyOn(getProviderConfigService(), "getProviderConfigById").mockResolvedValue({
    isEnabled: false,
  } as any);
  const fallback = spyOn(getProviderConfigService(), "getProviderConfigForUse");
  await expect(new AwsProvider().getConfig("eu-central-1")).rejects.toThrow("config is disabled");
  expect(fallback).not.toHaveBeenCalled();
});
