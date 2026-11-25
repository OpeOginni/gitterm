import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRecords, saveRecord, type MoveRecord } from "./records.js";

let home: string;
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
