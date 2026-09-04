import { describe, expect, test } from "bun:test";
import {
  formatImageReference,
  isFloatingTag,
  parseImageReference,
  parseWwwAuthenticate,
  resolveCustomWorkspaceImage,
} from "./workspace-image";

describe("parseImageReference", () => {
  test("normalises Docker Hub shorthand", () => {
    expect(parseImageReference("node:20")).toEqual({
      registry: "registry-1.docker.io",
      repository: "library/node",
      tag: "20",
      digest: null,
    });
    expect(parseImageReference("acme/agent-runner")?.repository).toBe("acme/agent-runner");
    expect(parseImageReference("acme/agent-runner")?.registry).toBe("registry-1.docker.io");
  });

  test("keeps explicit registries and digests", () => {
    const parsed = parseImageReference("ghcr.io/acme/agent-runner:1.4.0@sha256:" + "a".repeat(64));
    expect(parsed?.registry).toBe("ghcr.io");
    expect(parsed?.repository).toBe("acme/agent-runner");
    expect(parsed?.tag).toBe("1.4.0");
    expect(parsed?.digest).toBe("sha256:" + "a".repeat(64));
    expect(parseImageReference("localhost:5000/tool")?.registry).toBe("localhost:5000");
  });

  test("rejects malformed references", () => {
    expect(parseImageReference("")).toBeNull();
    expect(parseImageReference("Acme/Tool")).toBeNull();
    expect(parseImageReference("ghcr.io/acme/tool:bad tag")).toBeNull();
  });

  test("formats back to a pullable string", () => {
    expect(formatImageReference(parseImageReference("node:20")!)).toBe("docker.io/library/node:20");
    expect(formatImageReference(parseImageReference("ghcr.io/acme/tool")!)).toBe(
      "ghcr.io/acme/tool",
    );
  });
});

test("floating tags are recognised", () => {
  expect(isFloatingTag(null)).toBe(true);
  expect(isFloatingTag("latest")).toBe(true);
  expect(isFloatingTag("1.4.0")).toBe(false);
});

test("parses a bearer challenge", () => {
  expect(
    parseWwwAuthenticate(
      'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:acme/tool:pull"',
    ),
  ).toEqual({
    realm: "https://auth.docker.io/token",
    service: "registry.docker.io",
    scope: "repository:acme/tool:pull",
  });
  expect(parseWwwAuthenticate('Basic realm="x"')).toBeNull();
});

describe("resolveCustomWorkspaceImage", () => {
  const digest = "sha256:" + "b".repeat(64);
  const publicRegistry = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/token")) return Response.json({ token: "anon" });
    return new Response(null, {
      status: 200,
      headers: { "docker-content-digest": digest },
    });
  }) as unknown as typeof fetch;

  test("pins floating tags to the verified digest", async () => {
    const resolved = await resolveCustomWorkspaceImage(
      "acme/tool:latest",
      "railway",
      publicRegistry,
    );
    expect(resolved).toEqual({ kind: "registry", reference: `docker.io/acme/tool@${digest}` });
  });

  test("keeps explicit version tags", async () => {
    const resolved = await resolveCustomWorkspaceImage(
      "ghcr.io/acme/tool:1.4.0",
      "aws",
      publicRegistry,
    );
    expect(resolved).toEqual({ kind: "registry", reference: "ghcr.io/acme/tool:1.4.0" });
  });

  test("rejects an unpinnable floating tag", async () => {
    const missingDigest = (async () =>
      new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(
      resolveCustomWorkspaceImage("ghcr.io/acme/tool:latest", "railway", missingDigest),
    ).rejects.toThrow(/did not return a valid digest/);
  });

  test("rejects private images with a clear reason", async () => {
    const privateRegistry = (async () =>
      new Response(null, {
        status: 401,
        headers: { "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' },
      })) as unknown as typeof fetch;
    // Anonymous token is issued but the manifest still 401s: private image.
    const fetchStub = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/token")) return Response.json({ token: "anon" });
      return privateRegistry(input);
    }) as unknown as typeof fetch;
    await expect(
      resolveCustomWorkspaceImage("ghcr.io/acme/secret:1.0", "daytona", fetchStub),
    ).rejects.toThrow(/private or does not exist/);
  });

  test("E2B takes a template id and skips registry checks", async () => {
    const neverFetch = (async () => {
      throw new Error("no network expected");
    }) as unknown as typeof fetch;
    await expect(
      resolveCustomWorkspaceImage("acme-python-runner", "e2b", neverFetch),
    ).resolves.toEqual({
      kind: "e2b-template",
      templateId: "acme-python-runner",
    });
  });

  test("unsupported providers are rejected", async () => {
    await expect(resolveCustomWorkspaceImage("acme/tool:1", "cloudflare")).rejects.toThrow(
      /does not support custom images/,
    );
  });
});
