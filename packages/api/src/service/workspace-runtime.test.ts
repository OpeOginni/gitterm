import { describe, expect, test } from "bun:test";
import { buildWorkspaceRuntimeAccess, resolveProjectDirectory } from "../service/workspace-runtime";

const workspace = {
  id: "ws-1",
  status: "running" as const,
  subdomain: "runtime",
  repositoryUrl: "https://github.com/acme/demo",
  repositoryBranch: "main",
  repositoryBaseCommit: "a".repeat(40),
  repositoryCheckoutRef: null,
  persistent: true,
  serverOnly: true,
  serverPassword: null,
};

describe("workspace runtime helpers", () => {
  test("uses provider-specific canonical project directories", () => {
    expect(resolveProjectDirectory("https://github.com/acme/demo", "e2b")).toBe(
      "/home/user/workspace/demo",
    );
    expect(resolveProjectDirectory("https://github.com/acme/demo.git", "daytona")).toBe(
      "/workspace/demo",
    );
    expect(resolveProjectDirectory(null, "railway")).toBe("/workspace");
  });

  test("never exposes control-plane headers", () => {
    const runtime = buildWorkspaceRuntimeAccess({
      workspace,
      headers: {
        "x-gitterm-cf-sandbox-id": "sandbox-1",
        "x-gitterm-cf-internal-key": "global-secret",
        "x-gitterm-cf-port": "4096",
      },
      providerKey: "cloudflare",
    });

    expect(runtime.headers).toEqual({
      "x-gitterm-cf-sandbox-id": "sandbox-1",
      "x-gitterm-cf-port": "4096",
    });
  });

  test("terminated runtimes never expose connection material", () => {
    const runtime = buildWorkspaceRuntimeAccess({
      workspace: { ...workspace, status: "terminated" },
      headers: { authorization: "Bearer secret" },
      password: "secret",
      providerKey: "railway",
    });

    expect(runtime.url).toBeNull();
    expect(runtime.headers).toBeUndefined();
    expect(runtime.password).toBeUndefined();
    expect(runtime.recoverable).toBe(false);
  });
});
