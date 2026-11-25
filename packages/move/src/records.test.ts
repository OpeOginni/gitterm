import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claimMove, loadRecords, saveRecord, type MoveRecord } from "./records.js";

let home: string;
/** The claim file of Pi session "session" that a process left when it died. */
const STALE = "pi%3Asession.0.lock";
const realHome = process.env.HOME;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "gitterm-records-"));
  process.env.HOME = home;
});
afterEach(async () => {
  process.env.HOME = realHome;
  await rm(home, { recursive: true, force: true });
});

const record = (workspaceId: string): MoveRecord => ({
  workspaceId,
  agent: "t3code",
  localRef: `thread-${workspaceId}`,
  localMark: 0,
  localCwd: "/tmp",
  root: "/tmp",
  head: "0".repeat(40),
  state: "",
  cloudRef: "cloud",
  cloudCwd: "/workspace",
  cloudDirectory: "/workspace",
  movedAt: new Date().toISOString(),
});

test("moves saved at the same time are all kept", async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `ws-${index}`);
  await Promise.all(ids.map((id) => saveRecord(record(id))));
  expect((await loadRecords()).map((item) => item.workspaceId).sort()).toEqual(ids.sort());

  // A return updates its own record and no other.
  await Promise.all([
    saveRecord({ ...record("ws-1"), returnedAt: "2026-11-24T00:00:00.000Z" }),
    saveRecord(record("ws-new")),
  ]);
  const records = await loadRecords();
  expect(records).toHaveLength(21);
  expect(records.filter((item) => item.returnedAt).map((item) => item.workspaceId)).toEqual([
    "ws-1",
  ]);

  // A damaged record hides only itself.
  await writeFile(path.join(home, ".config", "gitterm", "moves", "ws-2.json"), "{");
  expect(await loadRecords()).toHaveLength(20);
});

test("calls racing for a claim a dead process left get one holder between them", async () => {
  const moves = path.join(home, ".config", "gitterm", "moves");
  await mkdir(moves, { recursive: true });
  await writeFile(path.join(moves, STALE), String(spawnSync("true").pid));
  const claims = await Promise.allSettled(
    Array.from({ length: 8 }, () => claimMove("pi", "session")),
  );
  const held = claims.filter((claim) => claim.status === "fulfilled");
  expect(held).toHaveLength(1);
  await (held[0] as PromiseFulfilledResult<() => Promise<void>>).value();
  // Free again once released.
  await (
    await claimMove("pi", "session")
  )();
});

test("processes racing for a claim a dead process left never hold it at once", async () => {
  const moves = path.join(home, ".config", "gitterm", "moves");
  await mkdir(moves, { recursive: true });
  await writeFile(path.join(moves, STALE), String(spawnSync("true").pid));
  // Each process claims, holds for a while, and reports when it held the claim.
  const script = path.join(home, "claim.ts");
  await writeFile(
    script,
    `import { claimMove } from ${JSON.stringify(path.join(import.meta.dir, "records.ts"))};
try {
  const release = await claimMove("pi", "session");
  const from = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const to = Date.now();
  await release();
  console.log(JSON.stringify([from, to]));
} catch (error) {
  if (!String(error).includes("already moving to the cloud")) throw error;
}`,
  );
  const runs = await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(process.execPath, [script], { env: { ...process.env, HOME: home } });
          let out = "";
          child.stdout.on("data", (chunk) => (out += chunk));
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)),
          );
        }),
    ),
  );
  const held = runs.flatMap((out) => (out.trim() ? [JSON.parse(out) as [number, number]] : []));
  expect(held.length).toBeGreaterThan(0);
  held.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < held.length; i++) expect(held[i]![0]).toBeGreaterThanOrEqual(held[i - 1]![1]);
  // Released: only the dead process's claim is left, and it holds nothing.
  expect((await readdir(moves)).filter((name) => name.endsWith(".lock"))).toEqual([STALE]);
}, 30_000);
