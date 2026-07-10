import { describe, expect, test } from "bun:test";
import {
  buildWorkspaceRuntimeAccess,
  isRecoverableWorkspaceStatus,
  isResumableWorkspaceStatus,
  resolveProjectDirectory,
} from "../service/workspace-runtime";

describe("workspace runtime helpers", () => {
  test("resolveProjectDirectory uses e2b home path", () => {
    expect(resolveProjectDirectory("https://github.com/acme/demo", "e2b")).toBe(
      "/home/user/workspace/demo",
    );
    expect(resolveProjectDirectory("https://github.com/acme/demo", "daytona")).toBe(
      "/workspace/demo",
    );
    expect(resolveProjectDirectory(null, "railway")).toBe("/workspace");
  });

  test("recoverable and resumable status semantics", () => {
    expect(isRecoverableWorkspaceStatus("running")).toBe(true);
    expect(isRecoverableWorkspaceStatus("paused")).toBe(true);
    expect(isRecoverableWorkspaceStatus("pending")).toBe(true);
    expect(isRecoverableWorkspaceStatus("terminated")).toBe(false);

    expect(isResumableWorkspaceStatus("paused")).toBe(true);
    expect(isResumableWorkspaceStatus("running")).toBe(false);
    expect(isResumableWorkspaceStatus("terminated")).toBe(false);
  });

  test("buildWorkspaceRuntimeAccess includes baseCommit and directory", () => {
    const runtime = buildWorkspaceRuntimeAccess({
      workspace: {
        id: "ws-1",
        status: "running",
        subdomain: "abc123",
        repositoryUrl: "https://github.com/acme/demo",
        repositoryBranch: "main",
        repositoryBaseCommit: "a".repeat(40),
        repositoryCheckoutRef: null,
        persistent: true,
        serverOnly: true,
        serverPassword: null,
      },
      headers: { "x-test": "1" },
      password: "secret",
      providerKey: "e2b",
    });

    expect(runtime.workspaceId).toBe("ws-1");
    expect(runtime.status).toBe("running");
    expect(runtime.directory).toBe("/home/user/workspace/demo");
    expect(runtime.baseCommit).toBe("a".repeat(40));
    expect(runtime.branch).toBe("main");
    expect(runtime.repo).toBe("https://github.com/acme/demo");
    expect(runtime.headers).toEqual({ "x-test": "1" });
    expect(runtime.password).toBe("secret");
    expect(runtime.persistent).toBe(true);
    expect(runtime.recoverable).toBe(true);
    expect(runtime.providerKey).toBe("e2b");
    expect(runtime.url).toContain("abc123");
  });

  test("buildWorkspaceRuntimeAccess strips Cloudflare control-plane key", () => {
    const runtime = buildWorkspaceRuntimeAccess({
      workspace: {
        id: "ws-cf",
        status: "running",
        subdomain: "cf123",
        repositoryUrl: "https://github.com/acme/demo",
        repositoryBranch: "main",
        repositoryBaseCommit: null,
        repositoryCheckoutRef: null,
        persistent: true,
        serverOnly: false,
        serverPassword: null,
      },
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

  test("terminated runtime is not recoverable", () => {
    const runtime = buildWorkspaceRuntimeAccess({
      workspace: {
        id: "ws-2",
        status: "terminated",
        subdomain: null,
        repositoryUrl: null,
        repositoryBranch: null,
        repositoryBaseCommit: null,
        repositoryCheckoutRef: null,
        persistent: false,
        serverOnly: false,
        serverPassword: null,
      },
      providerKey: "railway",
    });

    expect(runtime.url).toBeNull();
    expect(runtime.recoverable).toBe(false);
  });
});
