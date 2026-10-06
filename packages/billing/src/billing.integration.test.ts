import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { agentType, cloudProvider, image } from "@gitterm/db/schema/cloud";
import { usageSession, workspace } from "@gitterm/db/schema/workspace";
import { createBilling } from "./index";
import { getMinutesUsedToday } from "./usage";

// Opt-in: runs only against an explicit, disposable database.
const testUrl = process.env.BILLING_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable BILLING_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;

const userId = `billing-test-${randomUUID()}`;
const minutes = (count: number) => count * 60_000;

async function seedWorkspace() {
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    name: "Billing test",
    email: `${userId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  const [provider] = await db
    .insert(cloudProvider)
    .values({ name: `billing-test-${randomUUID()}`, providerKey: "e2b" })
    .returning();
  const suffix = randomUUID();
  const [agent] = await db
    .insert(agentType)
    .values({ key: `billing-${suffix}`, name: `billing-${suffix}` })
    .returning();
  const [agentImage] = await db
    .insert(image)
    .values({ name: `billing-${suffix}`, imageId: "billing-test", agentTypeId: agent!.id })
    .returning();
  const [created] = await db
    .insert(workspace)
    .values({
      externalInstanceId: "billing-test",
      userId,
      imageId: agentImage!.id,
      cloudProviderId: provider!.id,
      upstreamUrl: null,
      domain: `${randomUUID()}.example.com`,
      subdomain: randomUUID().slice(0, 12),
      status: "running",
      startedAt: now,
      updatedAt: now,
    } as typeof workspace.$inferInsert)
    .returning();
  return created!.id;
}

describe("managed billing", () => {
  afterAll(async () => {
    if (testUrl) await db.delete(user).where(eq(user.id, userId));
  });

  integration("derives today's runtime from closed and running sessions", async () => {
    const workspaceId = await seedWorkspace();
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await db.insert(usageSession).values([
      // Crossed midnight: only the 10 minutes after midnight count today.
      {
        workspaceId,
        userId,
        startedAt: new Date(midnight.getTime() - minutes(30)),
        stoppedAt: new Date(midnight.getTime() + minutes(10)),
      },
      // Still running: counts up to now.
      { workspaceId, userId, startedAt: new Date(now.getTime() - minutes(20)) },
    ]);

    const used = (await getMinutesUsedToday([userId], now)).get(userId) ?? 0;
    const expected = Math.min(10, (now.getTime() - midnight.getTime()) / 60_000) + 20;
    expect(Math.abs(used - expected)).toBeLessThanOrEqual(1);
  });

  integration("stops free users at their daily limit and lifts paid plans", async () => {
    const billing = createBilling();
    // 30 running minutes today; the free limit is 60 by default.
    expect((await billing.checkRunAllowance(userId)).allowed).toBe(true);

    await db.insert(usageSession).values({
      workspaceId: (await db.query.workspace.findFirst({ where: eq(workspace.userId, userId) }))!
        .id,
      userId,
      startedAt: new Date(Date.now() - minutes(45)),
      stoppedAt: new Date(),
    });
    expect((await billing.getUsersOverAllowance([userId])).has(userId)).toBe(true);
    expect((await billing.getEntitlements(userId)).plan).toBe("free");

    await billing.setPlan(userId, "pro");
    expect((await billing.getEntitlements(userId)).machineAccess).toBe("any");
    expect((await billing.getUsersOverAllowance([userId])).has(userId)).toBe(false);
    expect(await billing.getAccount(userId)).toMatchObject({ plan: "pro", planName: "Pro" });
  });
});
