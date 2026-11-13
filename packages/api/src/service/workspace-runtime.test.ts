import { describe, expect, test } from "bun:test";
import {
  buildWorkspaceRuntimeAccess,
  mayReconcilePending,
  resolveProjectDirectory,
} from "../service/workspace-runtime";

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
    expect(resolveProjectDirectory("https://github.com/acme/demo", "vercel")).toBe(
      "/vercel/sandbox/demo",
    );
    expect(resolveProjectDirectory("https://github.com/acme/demo", "boat")).toBe("/home/user/demo");
    expect(resolveProjectDirectory("https://github.com/acme/demo", "exedev")).toBe(
      "/home/exedev/demo",
    );
    expect(resolveProjectDirectory(null, "railway")).toBe("/workspace/workspace");
    expect(resolveProjectDirectory(null, "e2b")).toBe("/home/user/workspace/workspace");
    expect(resolveProjectDirectory(null, "gitterm")).toBe("/home/user/workspace/workspace");
    expect(resolveProjectDirectory(null, "boat")).toBe("/home/user/workspace");
    expect(resolveProjectDirectory(null, "daytona")).toBe("/workspace");
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

describe("mayReconcilePending", () => {
  const now = Date.now();
  const held = new Date(now + 60_000);
  const lapsed = new Date(now - 1_000);
  const creating = { status: "pending", upstreamUrl: null, operationLeaseUntil: held };
  const restarting = { status: "pending", upstreamUrl: "https://agent", operationLeaseUntil: held };

  test("leaves a create or restart to its operation while it holds the lease", () => {
    expect(mayReconcilePending(creating, "running", now)).toBe(false);
    expect(mayReconcilePending(restarting, "running", now)).toBe(false);
    expect(mayReconcilePending(restarting, "paused", now)).toBe(false);
  });

  test("never publishes a create that didn't finish, even once its owner is gone", () => {
    const abandoned = { ...creating, operationLeaseUntil: lapsed };
    expect(mayReconcilePending(abandoned, "running", now)).toBe(false);
    expect(mayReconcilePending({ ...abandoned, operationLeaseUntil: null }, "paused", now)).toBe(
      false,
    );
  });

  test("takes the provider's word on a restart with no owner, and on a loss", () => {
    expect(mayReconcilePending({ ...restarting, operationLeaseUntil: null }, "running", now)).toBe(
      true,
    );
    expect(mayReconcilePending({ ...restarting, operationLeaseUntil: lapsed }, "paused", now)).toBe(
      true,
    );
    expect(mayReconcilePending(creating, "terminated", now)).toBe(true);
    expect(mayReconcilePending({ ...restarting, status: "running" }, "paused", now)).toBe(true);
  });
});
