import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { billingMachineRate } from "@gitterm/db/schema/billing";
import { agentType, cloudProvider, image, machineProfile } from "@gitterm/db/schema/cloud";
import { usageSession, workspace } from "@gitterm/db/schema/workspace";
import { createBilling } from "./index";
import { PLANS, type PlanId } from "./plans";
import { setPlan } from "./accounts";
import { getMinutesUsedToday } from "./usage";

// Opt-in: runs only against an explicit, disposable database.
const testUrl = process.env.BILLING_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable BILLING_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;

const minutes = (count: number) => count * 60_000;
// Test sizes cost $6/hour: 10 cents a minute.
const CENTS_PER_MINUTE = 10;
const minutesFor = (cents: number) => cents / CENTS_PER_MINUTE;
const proIncluded = PLANS.pro.includedComputeCents!;
const growthIncluded = PLANS.growth.includedComputeCents!;
const userIds: string[] = [];
let profileId = "";
let providerId = "";
let imageId = "";

async function createUser(): Promise<string> {
  const id = `billing-test-${randomUUID()}`;
  const now = new Date();
  await db.insert(user).values({
    id,
    name: "Billing test",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  userIds.push(id);
  return id;
}

async function createWorkspace(userId: string): Promise<string> {
  const now = new Date();
  const [created] = await db
    .insert(workspace)
    .values({
      externalInstanceId: "billing-test",
      userId,
      imageId,
      cloudProviderId: providerId,
      machineProfileId: profileId,
      domain: `${randomUUID()}.example.com`,
      subdomain: randomUUID().slice(0, 12),
      status: "running",
      startedAt: now,
      updatedAt: now,
    } as typeof workspace.$inferInsert)
    .returning();
  return created!.id;
}

/** Subscribe with a period that started ten days ago, so long test sessions fit inside it. */
async function subscribe(userId: string, plan: PlanId) {
  const day = 24 * minutes(60);
  await setPlan(userId, plan, {
    start: new Date(Date.now() - 10 * day),
    end: new Date(Date.now() + 20 * day),
  });
}

/** A session that ran from `startedAgo` to `stoppedAgo` minutes ago (null = still running). */
async function addSession(userId: string, startedAgo: number, stoppedAgo: number | null) {
  const workspaceId = await createWorkspace(userId);
  const now = Date.now();
  await db.insert(usageSession).values({
    workspaceId,
    userId,
    startedAt: new Date(now - minutes(startedAgo)),
    stoppedAt: stoppedAgo === null ? null : new Date(now - minutes(stoppedAgo)),
  });
}

describe("managed billing", () => {
  const billing = createBilling();

  beforeAll(async () => {
    if (!testUrl) return;
    const suffix = randomUUID();
    const [provider] = await db
      .insert(cloudProvider)
      .values({ name: `billing-${suffix}`, providerKey: "e2b" })
      .returning();
    providerId = provider!.id;
    const [agent] = await db
      .insert(agentType)
      .values({ key: `billing-${suffix}`, name: `billing-${suffix}` })
      .returning();
    const [agentImage] = await db
      .insert(image)
      .values({ name: `billing-${suffix}`, imageId: "billing-test", agentTypeId: agent!.id })
      .returning();
    imageId = agentImage!.id;
    const [profile] = await db
      .insert(machineProfile)
      .values({
        cloudProviderId: providerId,
        key: "standard",
        name: "Standard",
        vcpus: 4,
        memoryGb: 8,
      })
      .returning();
    profileId = profile!.id;
    // $6/hour, priced from well before any test session.
    await db.insert(billingMachineRate).values({
      machineProfileId: profileId,
      microsPerHour: 6_000_000,
      effectiveFrom: new Date(Date.now() - 24 * 60 * minutes(60)),
    });
  });

  afterAll(async () => {
    if (!testUrl) return;
    for (const id of userIds) await db.delete(user).where(eq(user.id, id));
    await db.delete(cloudProvider).where(eq(cloudProvider.id, providerId));
  });

  integration("derives today's runtime from closed and running sessions", async () => {
    const userId = await createUser();
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const workspaceId = await createWorkspace(userId);
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

  integration("stops free users at their daily runtime limit", async () => {
    const userId = await createUser();
    await addSession(userId, 30, 0);
    expect((await billing.checkRunAllowance(userId)).allowed).toBe(true);
    await addSession(userId, 45, 0);
    expect((await billing.getUsersOverAllowance([userId])).has(userId)).toBe(true);
    expect((await billing.getEntitlements(userId)).machineAccess).toBe("smallest");
  });

  integration("spends paid plans' included compute at each size's price", async () => {
    const userId = await createUser();
    await subscribe(userId, "pro");
    // 90% of the included compute: allowed, no daily limit.
    const usedCents = proIncluded * 0.9;
    await addSession(userId, minutesFor(usedCents), 0);
    const account = await billing.getAccount(userId);
    expect(account?.dailyMinutes).toBeNull();
    expect(account?.compute).toMatchObject({ includedCents: proIncluded, overageCents: 0 });
    expect(Math.abs(account!.compute!.usedCents - usedCents)).toBeLessThanOrEqual(2);
    expect((await billing.checkRunAllowance(userId)).allowed).toBe(true);

    // A running workspace past the rest of the balance blocks new starts.
    await addSession(userId, minutesFor(proIncluded * 0.2), null);
    const blocked = await billing.checkRunAllowance(userId);
    expect(blocked.allowed).toBe(false);
    expect((await billing.getAccount(userId))?.compute?.runningCentsPerHour).toBe(600);
  });

  integration("pay-as-you-go continues up to the spend cap", async () => {
    const userId = await createUser();
    await subscribe(userId, "pro");
    await addSession(userId, minutesFor(proIncluded + 200), 0); // $2 over the included compute
    expect((await billing.checkRunAllowance(userId)).allowed).toBe(false);

    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 500 });
    expect((await billing.checkRunAllowance(userId)).allowed).toBe(true);
    expect((await billing.getAccount(userId))?.compute?.overageCents).toBe(200);

    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 150 });
    const capped = await billing.checkRunAllowance(userId);
    expect(capped.allowed).toBe(false);
    expect(capped.allowed ? "" : capped.reason).toContain("$1.50");

    await expect(
      billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: null }),
    ).rejects.toThrow();
  });

  integration("discounts Growth overage and keeps earlier usage at its old price", async () => {
    const userId = await createUser();
    await subscribe(userId, "growth");
    await billing.updateSettings(userId, { payAsYouGo: true, spendCapCents: 10_000 });
    // $20 over the included compute, with Growth's overage discount.
    await addSession(userId, minutesFor(growthIncluded + 2000), 0);
    const overage = 2000 * (1 - PLANS.growth.overageDiscountPercent / 100);
    expect((await billing.getAccount(userId))?.compute?.overageCents).toBe(overage);

    // A new price applies to sessions starting later, not to this one.
    await billing.setMachinePrice(profileId, 12_000_000);
    expect((await billing.getMachinePrices([profileId])).get(profileId)).toBe(12_000_000);
    expect((await billing.getAccount(userId))?.compute?.overageCents).toBe(overage);
    await billing.setMachinePrice(profileId, 6_000_000);
  });

  integration("sends each usage alert once per period", async () => {
    const userId = await createUser();
    await subscribe(userId, "pro");
    await addSession(userId, minutesFor(proIncluded * 0.95), 0); // past 90% of the balance

    const first = (await billing.runPeriodicTasks()).filter((notice) => notice.userId === userId);
    expect(first).toHaveLength(1);
    expect(first[0]!.subject).toContain("90%");
    const second = (await billing.runPeriodicTasks()).filter((notice) => notice.userId === userId);
    expect(second).toHaveLength(0);
  });
});
