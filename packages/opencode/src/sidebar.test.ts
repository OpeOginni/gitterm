import { expect, test } from "bun:test";
import type { SandboxRecord } from "@gitterm/sdk/sandbox/store";
import { sidebarRows, truncate } from "./sidebar";

const record = (overrides: Partial<SandboxRecord>): SandboxRecord => ({
  mode: "direct",
  provider: "e2b",
  account: "e2b",
  id: "sbx",
  name: "Sandbox",
  purpose: "",
  project: "/repo",
  sessionId: null,
  state: "running",
  publicPreviews: false,
  createdAt: "2026-11-03T10:00:00.000Z",
  expiresAt: null,
  snapshot: null,
  jobs: {},
  previews: {},
  updatedAt: "2026-11-03T10:00:00.000Z",
  ...overrides,
});

test("lists this checkout's live sandboxes, newest first, with what they are doing", () => {
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  const rows = sidebarRows(
    [
      record({ id: "old", name: "Old", createdAt: "2026-11-03T09:00:00.000Z" }),
      record({
        id: "tests",
        name: "Integration tests",
        purpose: "run integration tests",
        createdAt: "2026-11-03T11:00:00.000Z",
        jobs: { j1: { status: "running" } as SandboxRecord["jobs"][string] },
        previews: { p: { port: 3000, jobId: null, url: "", public: false } },
      }),
      record({
        id: "paused",
        name: "Paused",
        state: "paused",
        jobs: { j1: { status: "running" } as SandboxRecord["jobs"][string] },
      }),
      record({ id: "gone", state: "terminated" }),
      record({ id: "expired", expiresAt: "2026-11-03T11:59:00.000Z" }),
      record({ id: "elsewhere", project: "/other" }),
    ],
    "/repo",
    now,
  );
  expect(rows.map((row) => row.id)).toEqual(["tests", "paused", "old"]);
  expect(rows[0]).toEqual({
    id: "tests",
    title: "Integration tests",
    detail: "1 running · :3000 · run integration tests",
    state: "running",
  });
  expect(rows[1]!.detail).toBe("paused · e2b");
});

test("long text is cut to the sidebar width", () => {
  expect(truncate("abcdef", 4)).toBe("abc…");
  expect(truncate("abc", 4)).toBe("abc");
});
