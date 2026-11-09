import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxBackend, SandboxInfo } from "./backend.js";
import { createSandboxClient } from "./client.js";
import { createFileSetupSnapshotStore } from "./setup-snapshots.js";
import { createFileSandboxStore } from "./store.js";

test("a checkout keeps several setup snapshots that go stale, are replaced, and are deleted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitterm-setup-"));
  const project = path.join(root, "app");
  await Bun.write(path.join(project, "package.json"), '{"name":"app"}');
  await writeFile(path.join(project, "bun.lock"), "v1");

  const identity = { mode: "direct" as const, provider: "e2b" as const, account: "mine" };
  const saved: string[] = [];
  const deleted: string[] = [];
  const created: Array<string | undefined> = [];
  const info = (id: string): SandboxInfo => ({
    ...identity,
    id,
    state: "running",
    name: id,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    labels: {},
  });
  const backend: SandboxBackend = {
    identity,
    home: "/home/user",
    capabilities: {
      expiry: "hard",
      previews: "either",
      pause: "stateful",
      maxLifetimeMs: 1e8,
      snapshots: "pauses",
    },
    async create(input) {
      created.push(input.snapshot);
      return info(`sbx${created.length}`);
    },
    get: async (id) => info(id),
    list: async () => [],
    destroy: async () => {},
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    writeFile: async () => {},
    readFile: async () => new Uint8Array(),
    preview: async () => ({ url: "", headers: {} }),
    snapshots: {
      effect: "pauses",
      async create(_id, name) {
        saved.push(name);
        return `snap${saved.length}`;
      },
      async delete(snapshotId) {
        deleted.push(snapshotId);
      },
    },
  };
  const client = createSandboxClient({
    backend,
    store: createFileSandboxStore(path.join(root, "state")),
    setupSnapshots: createFileSetupSnapshotStore(path.join(root, "state", "setup")),
  });

  try {
    expect(await client.setupSnapshots(project)).toEqual([]);
    const sandbox = await client.create({ name: "first" });
    const deps = await client.saveSetupSnapshot(sandbox, {
      label: "deps",
      project,
      note: "bun install",
    });
    expect(deps.record.snapshotId).toBe("snap1");
    expect(saved[0]).toStartWith("gitterm-setup-app-");
    // A second one for the same checkout, and one tied to no checkout.
    await client.saveSetupSnapshot(sandbox, { label: "deps + postgres", project });
    await client.saveSetupSnapshot(sandbox, { label: "playwright" });
    expect(saved[2]).toStartWith("gitterm-setup-shared-playwright-");
    const other = path.join(root, "other");
    await Bun.write(path.join(other, "package.json"), "{}");
    await client.saveSetupSnapshot(sandbox, { label: "other deps", project: other });

    const forApp = await client.setupSnapshots(project);
    expect(forApp.map((item) => item.record.label).toSorted()).toEqual([
      "deps",
      "deps + postgres",
      "playwright",
    ]);
    expect(forApp.every((item) => item.changed.length === 0)).toBe(true);
    expect(await client.setupSnapshots()).toHaveLength(4);

    // A dependency change makes the tied ones stale; an unrelated file does not.
    await writeFile(path.join(project, "README.md"), "hi");
    await writeFile(path.join(project, "bun.lock"), "v2");
    const stale = Object.fromEntries(
      (await client.setupSnapshots(project)).map((item) => [item.record.label, item.changed]),
    );
    expect(stale).toEqual({ deps: ["bun.lock"], "deps + postgres": ["bun.lock"], playwright: [] });

    await client.create({ name: "second", snapshot: "snap1" });
    expect(created).toEqual([undefined, "snap1"]);

    const replaced = await client.saveSetupSnapshot(sandbox, {
      label: "deps",
      project,
      replace: "snap1",
    });
    expect(replaced.replaced).toBe("snap1");
    expect(deleted).toEqual(["snap1"]);
    expect((await client.setupSnapshots()).map((item) => item.record.snapshotId)).not.toContain(
      "snap1",
    );

    expect((await client.deleteSetupSnapshot("snap3")).label).toBe("playwright");
    expect(deleted).toEqual(["snap1", "snap3"]);
    await expect(client.deleteSetupSnapshot("snap3")).rejects.toThrow("No saved snapshot snap3");
    expect(await client.setupSnapshots(project)).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
