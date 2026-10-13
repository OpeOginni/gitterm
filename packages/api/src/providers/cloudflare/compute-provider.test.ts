import { expect, test } from "bun:test";
import { CloudflareComputeProvider } from "./compute-provider";
import type { WorkspaceConfig } from "../compute";

const config: WorkspaceConfig = {
  workspaceId: "workspace",
  userId: "user",
  imageId: "image",
  subdomain: "ws",
  imageProviderMetadata: { cloudflare: { startCommand: "legacy-start", port: 4096 } },
  provisioningSpec: {
    agent: {
      files: [],
      env: {},
      usesServerPassword: false,
      serve: { command: "t3 start", port: 4096, accessCredentialCommand: "mint-token" },
    },
    workspaceProfile: "standard",
    editorAccessEnabled: false,
  },
};

test("Cloudflare transports the standard agent command and access credential", async () => {
  const provider = new CloudflareComputeProvider();
  const internals = provider as unknown as {
    requireConfig: () => Promise<unknown>;
    callControl: (url: string, key: string, path: string, payload: object) => Promise<Response>;
  };
  internals.requireConfig = async () => ({
    workerUrl: "https://worker.example",
    internalApiKey: "internal",
  });
  internals.callControl = async (_url, _key, path, payload) => {
    if (path === "/__gitterm/provision") {
      expect(payload).toMatchObject({
        startCommand: "t3 start",
        accessCredentialCommand: "mint-token",
      });
    }
    return Response.json({ ready: true, accessCredential: "pairing-token" });
  };
  const result = await provider.createWorkspace(config);
  expect(result.accessCredential).toBe("pairing-token");
  expect(await provider.resumeWorkspace(result.externalServiceId)).toEqual({
    accessCredential: "pairing-token",
  });
  internals.callControl = async () => Response.json({ exitCode: 0, stdout: "fresh-token" });
  expect(await provider.execCommand(result.externalServiceId, "mint-token")).toEqual({
    exitCode: 0,
    stdout: "fresh-token",
  });
});

test("old Cloudflare workers cannot silently mark a pairing workspace ready without credentials", async () => {
  const provider = new CloudflareComputeProvider();
  const internals = provider as unknown as {
    requireConfig: () => Promise<unknown>;
    callControl: () => Promise<Response>;
  };
  internals.requireConfig = async () => ({
    workerUrl: "https://worker.example",
    internalApiKey: "internal",
  });
  internals.callControl = async () => Response.json({ ready: true });
  await expect(provider.createWorkspace(config)).rejects.toThrow("update the sandbox worker");
});
