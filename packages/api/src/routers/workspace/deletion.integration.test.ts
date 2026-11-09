import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db, eq, inArray } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { agentType, cloudProvider, image } from "@gitterm/db/schema/cloud";
import { workspace, workspaceTermination } from "@gitterm/db/schema/workspace";
import type { Context } from "../../context";
import { workspaceRouter } from "./managment";
import { E2BProvider } from "../../providers/e2b";
import * as proxyCache from "../../service/proxy-cache";
import { retryWorkspaceTerminations } from "../../service/workspace-termination";

/**
 * Ordinary workspace deletion against a disposable local database with the provider faked:
 *   DATABASE_URL=$URL WORKSPACE_DATABASE_TEST_URL=$URL bun test ...
 */
const testUrl = process.env.WORKSPACE_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable WORKSPACE_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;

const userId = `deletion-test-${randomUUID()}`;
const caller = () =>
  workspaceRouter.createCaller({ session: { user: { id: userId } } } as unknown as Context);
const terminated: string[] = [];
let failures = 0;
const mocks: { mockRestore(): void }[] = [];

async function createRunningWorkspace() {
  const [provider] = await db
    .select()
    .from(cloudProvider)
    .where(eq(cloudProvider.providerKey, "e2b"));
  const [opencodeImage] = await db
    .select({ id: image.id })
    .from(image)
    .innerJoin(agentType, eq(image.agentTypeId, agentType.id))
    .where(eq(agentType.key, "opencode"))
    .limit(1);
  const id = randomUUID();
  await db.insert(workspace).values({
    id,
    userId,
    externalInstanceId: `sbx-${id}`,
    imageId: opencodeImage!.id,
    cloudProviderId: provider!.id,
    domain: "",
    status: "running",
    startedAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const queued = (id: string) =>
  db.select().from(workspaceTermination).where(eq(workspaceTermination.workspaceId, id));

beforeAll(async () => {
  if (!testUrl) return;
  mocks.push(
    spyOn(E2BProvider.prototype, "terminateWorkspace").mockImplementation(async (id: string) => {
      terminated.push(id);
      if (failures > 0) {
        failures--;
        throw new Error("provider deletion failed");
      }
    }),
    spyOn(proxyCache, "invalidateProxyCacheForWorkspace").mockResolvedValue(),
    spyOn(proxyCache, "invalidateAllProxyRouteAccessCache").mockResolvedValue(),
  );
  await db.insert(user).values({
    id: userId,
    name: "Deletion test",
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  for (const mock of mocks) mock.mockRestore();
  if (!testUrl) return;
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.userId, userId));
  const ids = rows.map((row) => row.id);
  if (ids.length) {
    await db.delete(workspaceTermination).where(inArray(workspaceTermination.workspaceId, ids));
    await db.delete(workspace).where(inArray(workspace.id, ids));
  }
  await db.delete(user).where(eq(user.id, userId));
});

integration("a successful deletion leaves nothing queued", async () => {
  const id = await createRunningWorkspace();
  const result = await caller().deleteWorkspace({ workspaceId: id });
  expect(result.cleanupInBackground).toBe(false);
  expect(terminated).toContain(`sbx-${id}`);
  expect(await queued(id)).toHaveLength(0);
  const [row] = await db.select().from(workspace).where(eq(workspace.id, id));
  expect(row).toMatchObject({ status: "terminated", externalInstanceId: "" });
});

integration("a failed provider deletion is queued and the worker retries it", async () => {
  const id = await createRunningWorkspace();
  failures = 1;
  const result = await caller().deleteWorkspace({ workspaceId: id });
  // Terminated for the user and for billing; provider cleanup continues in the background.
  expect(result).toMatchObject({ success: true, cleanupInBackground: true });
  expect(result.workspace?.status).toBe("terminated");
  const [entry] = await queued(id);
  expect(entry).toBeDefined();
  // Not leased: the worker can pick it up on its next pass.
  expect(entry!.leaseUntil).toBeNull();

  await retryWorkspaceTerminations();
  expect(terminated.filter((value) => value === `sbx-${id}`)).toHaveLength(2);
  expect(await queued(id)).toHaveLength(0);
  const [row] = await db.select().from(workspace).where(eq(workspace.id, id));
  expect(row!.externalInstanceId).toBe("");
});

integration("deleting again retries a pending cleanup immediately", async () => {
  const id = await createRunningWorkspace();
  failures = 1;
  await caller().deleteWorkspace({ workspaceId: id });
  const result = await caller().deleteWorkspace({ workspaceId: id });
  expect(result.cleanupInBackground).toBe(false);
  expect(terminated.filter((value) => value === `sbx-${id}`)).toHaveLength(2);
  expect(await queued(id)).toHaveLength(0);
});

integration("a delete while the worker holds the cleanup does not start a second one", async () => {
  const id = await createRunningWorkspace();
  await db
    .insert(workspaceTermination)
    .values({ workspaceId: id, leaseUntil: new Date(Date.now() + 60_000) });
  const before = terminated.length;
  const result = await caller().deleteWorkspace({ workspaceId: id });
  expect(result.cleanupInBackground).toBe(true);
  expect(terminated.length).toBe(before);
  expect(await queued(id)).toHaveLength(1);
});
