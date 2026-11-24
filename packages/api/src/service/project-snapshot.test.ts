import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { db } from "@gitterm/db";
import * as providers from "../providers";
import { projectSnapshotStatus, saveProjectSnapshot } from "./project-snapshot";
import * as transports from "./sandbox-transport";

/** A query that resolves to `rows` however it is built. */
const query = (rows: unknown): unknown =>
  new Proxy(() => {}, {
    get: (_, key) =>
      key === "then" ? (resolve: (value: unknown) => void) => resolve(rows) : () => query(rows),
  });
/** The rows each `db.select` resolves to, in order. */
let selects: unknown[][] = [];
const create = mock(async () => "external-snap");
let exitCode = 0;

const mocks = [
  spyOn(db, "select").mockImplementation((() => query(selects.shift() ?? [])) as never),
  spyOn(db, "delete").mockImplementation((() => query(undefined)) as never),
  spyOn(db, "update").mockImplementation((() => query([{ id: "pending" }])) as never),
  spyOn(db, "transaction").mockImplementation(((run: (tx: unknown) => unknown) =>
    run(query([{ id: "pending" }]))) as never),
  spyOn(providers, "getProviderByCloudProviderId").mockResolvedValue({
    execCommand: async () => ({ exitCode, stdout: "" }),
  } as never),
  spyOn(transports, "managedSandboxTransport").mockResolvedValue({
    snapshots: { create, delete: async () => {} },
  } as never),
];
afterAll(() => mocks.forEach((spy) => spy.mockRestore()));
beforeEach(() => {
  create.mockClear();
  exitCode = 0;
});

const row = {
  id: "ws1",
  userId: "u1",
  imageId: "image1",
  repositoryUrl: "https://github.com/acme/app",
  cloudProviderId: "provider1",
  machineProfileId: null,
  status: "running",
  externalInstanceId: "sandbox:daytona:s1",
} as never;

test("only OpenCode workspaces can be kept, as only OpenCode's data is removed first", async () => {
  // The saved snapshot lookup, then the workspace's agent.
  selects = [[], [{ provisionerKey: "pi" }]];
  expect(await projectSnapshotStatus(row, "daytona", null)).toMatchObject({
    available: false,
    reason: "agent",
  });
  selects = [[{ provisionerKey: "t3code" }]];
  await expect(saveProjectSnapshot(row, "daytona", null)).rejects.toThrow("Only OpenCode");
  expect(create).not.toHaveBeenCalled();

  selects = [[], [{ provisionerKey: "opencode" }]];
  expect(await projectSnapshotStatus(row, "daytona", null)).toMatchObject({ available: true });
});

test("a workspace whose scrub fails is not saved", async () => {
  selects = [[{ provisionerKey: "opencode" }]];
  exitCode = 1;
  await expect(saveProjectSnapshot(row, "daytona", null)).rejects.toThrow("could not be removed");
  expect(create).not.toHaveBeenCalled();

  selects = [[{ provisionerKey: "opencode" }]];
  exitCode = 0;
  await saveProjectSnapshot(row, "daytona", null);
  expect(create).toHaveBeenCalledTimes(1);
});
