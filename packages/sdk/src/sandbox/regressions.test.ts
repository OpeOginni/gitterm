import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyArtifact, ArtifactConflictError } from "./artifacts";
import { startPreviewProxy } from "./proxy";
import { captureSource } from "./source";
import { createFileSandboxStore, type SandboxRecord } from "./store";

/** Regression tests for review findings on PR #197. */

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

async function checkout(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "gitterm-review-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  git("add", ".");
  git("commit", "-qm", "init");
  return root;
}

const record = (id: string): SandboxRecord => ({
  mode: "direct",
  provider: "e2b",
  account: "a",
  id,
  name: "n",
  purpose: "",
  project: null,
  sessionId: null,
  state: "running",
  publicPreviews: false,
  createdAt: new Date().toISOString(),
  expiresAt: null,
  snapshot: null,
  jobs: {},
  previews: {},
  updatedAt: new Date().toISOString(),
});

describe("review regressions", () => {
  test("#1 an artifact cannot be written through a symlinked parent outside the checkout", async () => {
    const root = await checkout({ "keep.txt": "x" });
    const outside = await mkdtemp(path.join(tmpdir(), "gitterm-outside-"));
    try {
      await symlink(outside, path.join(root, "dist"));
      const staged = path.join(outside, "..", `artifact-${Date.now()}`);
      await writeFile(staged, "payload");
      const snapshot = (await captureSource(root)).snapshot;
      await expect(
        applyArtifact({
          artifact: { localPath: staged, sha256: sha("payload") },
          snapshot,
          target: "dist/result.txt",
        }),
      ).rejects.toBeInstanceOf(ArtifactConflictError);
      expect(await readdir(outside)).toEqual([]);
      await rm(staged, { force: true });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("#8 concurrent record updates neither fail nor drop each other's jobs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gitterm-store-"));
    try {
      const store = createFileSandboxStore(directory);
      await store.put(record("sbx"));
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, index) =>
          store.update(record("sbx"), (current) => {
            current.jobs[`job_${index}`] = {
              id: `job_${index}`,
              command: "true",
              cwd: "/",
              snapshotId: null,
              snapshotDigest: null,
              status: "running",
              exitCode: null,
              startedAt: null,
              finishedAt: null,
              timeoutMs: 1,
              secretNames: [],
            };
          }),
        ),
      );
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      expect(Object.keys((await store.get(record("sbx")))!.jobs)).toHaveLength(20);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("#9 identical trees in two checkouts keep separate snapshot metadata", async () => {
    const first = await checkout({ "a.txt": "same" });
    const second = await checkout({ "a.txt": "same" });
    const directory = await mkdtemp(path.join(tmpdir(), "gitterm-store-"));
    try {
      const store = createFileSandboxStore(directory);
      const one = (await captureSource(first)).snapshot;
      const two = (await captureSource(second)).snapshot;
      expect(one.digest).toBe(two.digest);
      await store.putSnapshot(one);
      await store.putSnapshot(two);
      expect(one.root).not.toBe(two.root);
      expect((await store.getSnapshot(one.id, one.root))?.root).toBe(one.root);
      expect((await store.getSnapshot(two.id, two.root))?.root).toBe(two.root);
    } finally {
      for (const dir of [first, second, directory]) await rm(dir, { recursive: true, force: true });
    }
  });

  test("#10 the preview proxy serves root-relative assets after opening its URL", async () => {
    const upstream = createServer((request, response) => {
      if (request.headers["x-access"] !== "secret") return response.writeHead(403).end();
      if (request.url === "/") return response.end('<script src="/app.js"></script>');
      if (request.url === "/app.js") return response.end("console.log(1)");
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const { port } = upstream.address() as AddressInfo;
    const proxy = await startPreviewProxy({
      url: `http://127.0.0.1:${port}/`,
      headers: { "x-access": "secret" },
    });
    try {
      // A browser opens the returned URL, then the page requests /app.js from the same origin.
      const opened = await fetch(proxy.url, { redirect: "manual" });
      const cookie = opened.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const page =
        opened.status >= 300 && opened.status < 400
          ? await fetch(new URL(opened.headers.get("location")!, proxy.url), {
              headers: { cookie },
            })
          : opened;
      expect(await page.text()).toContain("/app.js");
      const asset = await fetch(new URL("/app.js", proxy.url), { headers: { cookie } });
      expect(asset.status).toBe(200);
      // Without the capability the proxy refuses.
      expect((await fetch(new URL("/app.js", proxy.url))).status).toBe(401);
    } finally {
      await proxy.close();
      upstream.close();
    }
  });

  test("#1b a crafted path cannot send provider headers to another host", async () => {
    const seen: string[] = [];
    const elsewhere = createServer((request, response) => {
      seen.push(String(request.headers["x-access"] ?? ""));
      response.end("elsewhere");
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
    let upstreamHits = 0;
    const upstream = createServer((_request, response) => {
      upstreamHits++;
      response.end("upstream");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startPreviewProxy({
      url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`,
      headers: { "x-access": "provider-secret" },
    });
    try {
      const opened = await fetch(proxy.url, { redirect: "manual" });
      const cookie = opened.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const origin = new URL(proxy.url).origin;
      const other = `127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
      // Raw request lines: fetch would normalize these paths before sending.
      for (const path of [
        `//${other}/steal`,
        `/\\${other}/steal`,
        `/x/..//${other}/steal`,
        `/.//${other}/steal`,
      ])
        await rawGet(origin, path, cookie);
      expect(seen).toEqual([]);
      // The crafted paths were accepted as ordinary paths on the provider's own host.
      expect(upstreamHits).toBeGreaterThan(0);
    } finally {
      await proxy.close();
      upstream.close();
      elsewhere.close();
    }
  });

  test("#2b each preview has its own host: cookies keep their names and stay off 127.0.0.1", async () => {
    const received: string[] = [];
    const upstream = createServer((request, response) => {
      received.push(String(request.headers.cookie ?? ""));
      response.setHeader(
        "set-cookie",
        "app_session=from-preview; Path=/; HttpOnly; Domain=up.test",
      );
      response.end("ok");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startPreviewProxy({
      url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`,
      headers: {},
    });
    try {
      const host = new URL(proxy.url).hostname;
      expect(host).toMatch(/^p-[0-9a-f]{16}\.localhost$/);
      const opened = await fetch(proxy.url, { redirect: "manual" });
      const capability = opened.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const first = await fetch(new URL("/", proxy.url), { headers: { cookie: capability } });
      // The app's own cookie name, host-only (no foreign Domain), so the browser keeps it.
      const setCookie = first.headers.getSetCookie()[0]!;
      expect(setCookie).toStartWith("app_session=from-preview");
      expect(setCookie.toLowerCase()).not.toContain("domain=");
      await fetch(new URL("/", proxy.url), {
        headers: { cookie: `${capability}; app_session=from-preview` },
      });
      expect(received.at(-1)).toBe("app_session=from-preview");
      // The same port reached as 127.0.0.1 (where other local apps' cookies live) is refused.
      const { port } = new URL(proxy.url);
      expect(
        (await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: capability } })).status,
      ).toBe(421);
    } finally {
      await proxy.close();
      upstream.close();
    }
  });

  test("#2c a malformed token is rejected without crashing the host process", async () => {
    const proxy = await startPreviewProxy({ url: "http://127.0.0.1:9/", headers: {} });
    try {
      const bad = encodeURIComponent("é".repeat(48));
      expect(
        (await fetch(`${new URL(proxy.url).origin}/?gitterm_preview_token=${bad}`)).status,
      ).toBe(401);
      expect(
        (await fetch(new URL("/", proxy.url), { headers: { cookie: `gitterm_preview=${bad}` } }))
          .status,
      ).toBe(401);
      // Still serving.
      expect((await fetch(`${new URL(proxy.url).origin}/`)).status).toBe(401);
    } finally {
      await proxy.close();
    }
  });
});

/** Sends a request line verbatim, bypassing URL normalization. */
async function rawGet(origin: string, path: string, cookie: string) {
  const { port, host } = new URL(origin);
  const net = await import("node:net");
  await new Promise<void>((resolve) => {
    const socket = net.connect(Number(port), "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", () => {});
    socket.on("close", () => resolve());
    socket.on("error", () => resolve());
    setTimeout(() => socket.destroy(), 2_000);
  });
}
