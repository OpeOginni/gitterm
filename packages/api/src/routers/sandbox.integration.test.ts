import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { db, eq, inArray } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import { usageSession, workspace, workspaceTermination } from "@gitterm/db/schema/workspace";
import { UNLIMITED_ENTITLEMENTS } from "@gitterm/schema/billing";
import * as transportModule from "../service/sandbox-transport";
import type { Context } from "../context";
import { sandboxRouter } from "./sandbox";
import * as billing from "../billing";
import * as activity from "../service/workspace-activity";
import * as proxyCache from "../service/proxy-cache";
import * as providerConfig from "../service/config/provider-config";
import { internalRouter } from "./internal";

/**
 * Managed sandboxes against a disposable local database, with the E2B transport faked.
 * SANDBOX_DATABASE_TEST_URL must equal DATABASE_URL and point at a throwaway database:
 *   ENABLE_USAGE_METERING=true DATABASE_URL=$URL SANDBOX_DATABASE_TEST_URL=$URL bun test ...
 */
const testUrl = process.env.SANDBOX_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable SANDBOX_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;

const userId = `sandbox-test-${randomUUID()}`;
const otherId = `sandbox-other-${randomUUID()}`;
const caller = (id: string) =>
  sandboxRouter.createCaller({ session: { user: { id } } } as unknown as Context);
const created = new Map<string, Record<string, string>>();
const commands: string[] = [];
const destroyed: string[] = [];
const allowanceChecks: unknown[] = [];
let workspaceLimit = 2;
let failDestroys = 0;
/** Provider-side state; destroy marks a sandbox gone unless `acceptOnlyDestroys` is set. */
const providerStates = new Map<string, "running" | "paused" | "terminated">();
let acceptOnlyDestroys = false;
const WEBHOOK_SECRET = "test-webhook-secret";
const mocks: { mockRestore(): void }[] = [];

beforeAll(async () => {
  if (!testUrl) return;
  const fake = {
    provider: "e2b" as const,
    home: "/home/user",
    async create(input: { labels: Record<string, string>; template?: string }) {
      const id = `fake-${randomUUID()}`;
      created.set(id, { ...input.labels, template: input.template ?? "" });
      return {
        id,
        state: "running" as const,
        labels: input.labels,
        template: "base",
        startedAt: new Date().toISOString(),
        expiresAt: null,
      };
    },
    async run(id: string, command: string) {
      commands.push(`${id}:${command}`);
      return { exitCode: command === "exit 4" ? 4 : 0, stdout: `ran ${command}`, stderr: "" };
    },
    async writeFile() {},
    async readFile() {
      return new Uint8Array([1, 2, 3]);
    },
    async destroy(id: string) {
      destroyed.push(id);
      if (failDestroys > 0) {
        failDestroys--;
        throw new Error("provider deletion failed");
      }
      // Like Daytona's default delete(): accepted, but the resource still exists for a while.
      if (!acceptOnlyDestroys) providerStates.set(id, "terminated");
    },
    async info(id: string) {
      return {
        id,
        state: providerStates.get(id) ?? "running",
        labels: {},
        startedAt: null,
        expiresAt: null,
      };
    },
    async preview(_id: string, port: number) {
      return { url: `https://${port}-fake.e2b.app`, headers: { "e2b-traffic-access-token": "t" } };
    },
  };
  mocks.push(
    // Like the real lookup, resolving the transport reads provider config from the database.
    spyOn(transportModule, "managedSandboxTransport").mockImplementation(
      async () => (await new Promise((resolve) => setTimeout(resolve, 50)), fake as never),
    ),
    spyOn(billing, "getBilling").mockResolvedValue({
      ...billing.unlimitedBilling,
      enabled: true,
      getEntitlements: async () => ({ ...UNLIMITED_ENTITLEMENTS, maxWorkspaces: workspaceLimit }),
      checkRunAllowance: async (id: string, input: unknown) => {
        allowanceChecks.push({ id, input });
        return { allowed: true };
      },
    }),
    spyOn(activity, "recordWorkspaceActivity").mockResolvedValue(),
    spyOn(proxyCache, "invalidateProxyCacheForWorkspace").mockResolvedValue(),
    spyOn(proxyCache, "invalidateAllProxyRouteAccessCache").mockResolvedValue(),
    spyOn(providerConfig, "getProviderConfigService").mockReturnValue({
      getProviderConfigForUse: async () => ({ webhookSecret: WEBHOOK_SECRET }),
    } as never),
  );
  await db.insert(user).values(
    [userId, otherId].map((id) => ({
      id,
      name: "Sandbox test",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});

afterAll(async () => {
  for (const mock of mocks) mock.mockRestore();
  if (!testUrl) return;
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(inArray(workspace.userId, [userId, otherId]));
  if (rows.length) {
    await db.delete(workspaceTermination).where(
      inArray(
        workspaceTermination.workspaceId,
        rows.map((row) => row.id),
      ),
    );
    await db.delete(workspace).where(
      inArray(
        workspace.id,
        rows.map((row) => row.id),
      ),
    );
  }
  await db.delete(user).where(inArray(user.id, [userId, otherId]));
});

integration(
  "managed sandboxes are billed workspaces with usage sessions and plan limits",
  async () => {
    const sandbox = await caller(userId).create({
      name: "managed",
      lifetimeMinutes: 30,
      metadata: { purpose: "test" },
    });
    expect(sandbox.status).toBe("running");
    expect(sandbox.expiresAt).not.toBeNull();

    const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    expect(row).toMatchObject({ userId, status: "running", serverOnly: true });
    expect(row!.machineProfileId).not.toBeNull();
    // Plan allowance is checked against the machine profile the sandbox is billed at.
    expect(allowanceChecks).toEqual([
      { id: userId, input: { action: "create", machineProfileId: row!.machineProfileId } },
    ]);
    // The provider handle is self-describing and labels identify the workspace and owner.
    expect(sandbox.provider).toBe("e2b");
    expect(row!.externalInstanceId).toStartWith("sandbox:e2b:");
    const providerId = row!.externalInstanceId.slice("sandbox:e2b:".length);
    expect(created.get(providerId)).toMatchObject({
      gitterm_workspace: sandbox.id,
      gitterm_workload: "sandbox",
      gitterm_user: userId,
    });

    const sessions = await db
      .select()
      .from(usageSession)
      .where(eq(usageSession.workspaceId, sandbox.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.stoppedAt).toBeNull();

    // Command failure is a result; the provider-side command ran in this sandbox only.
    expect(await caller(userId).run({ sandboxId: sandbox.id, command: "exit 4" })).toMatchObject({
      exitCode: 4,
    });
    expect(commands.at(-1)).toBe(`${providerId}:exit 4`);

    // Another user cannot see or operate it.
    await expect(caller(otherId).get({ sandboxId: sandbox.id })).rejects.toThrow(/not found/i);
    await expect(caller(otherId).run({ sandboxId: sandbox.id, command: "id" })).rejects.toThrow(
      /not found/i,
    );
    await expect(caller(otherId).terminate({ sandboxId: sandbox.id })).rejects.toThrow(
      /not found/i,
    );
    expect(await caller(otherId).list()).toEqual([]);

    await caller(userId).create({ name: "second", lifetimeMinutes: 5 });
    await expect(caller(userId).create({ name: "third", lifetimeMinutes: 5 })).rejects.toThrow(
      /plan limit of 2/,
    );

    await caller(userId).terminate({ sandboxId: sandbox.id });
    // Termination reached the sandbox transport through the provider handle wrapper.
    expect(destroyed).toContain(providerId);
    const [after] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    expect(after!.status).toBe("terminated");
    const closed = await db
      .select()
      .from(usageSession)
      .where(eq(usageSession.workspaceId, sandbox.id));
    expect(closed[0]!.stoppedAt).not.toBeNull();
    expect(closed[0]!.stopSource).toBe("manual");
    await expect(caller(userId).run({ sandboxId: sandbox.id, command: "id" })).rejects.toThrow(
      /terminated/,
    );
  },
);

const internal = () =>
  internalRouter.createCaller({
    internalApiKey: process.env.INTERNAL_API_KEY,
    e2bSignature: null,
  } as unknown as Context);

async function terminateAll(id: string) {
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.userId, id));
  for (const row of rows)
    await caller(id)
      .terminate({ sandboxId: row.id })
      .catch(() => {});
}

integration(
  "#4 a failed provider deletion stays queued and is retried, never reported done",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "delete-fails", lifetimeMinutes: 5 });
    const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
    const providerId = row!.externalInstanceId.split(":").at(-1)!;

    failDestroys = 1;
    const before = destroyed.length;
    await expect(caller(userId).terminate({ sandboxId: sandbox.id })).rejects.toThrow();
    expect(destroyed.slice(before)).toEqual([providerId]);
    // The cleanup is durably queued and the sandbox is not reported as deleted.
    expect(
      await db
        .select()
        .from(workspaceTermination)
        .where(eq(workspaceTermination.workspaceId, sandbox.id)),
    ).toHaveLength(1);
    expect((await caller(userId).get({ sandboxId: sandbox.id })).deleted).toBe(false);

    // A retry calls the provider again and only then confirms deletion.
    await caller(userId).terminate({ sandboxId: sandbox.id });
    expect(destroyed.slice(before)).toEqual([providerId, providerId]);
    expect(
      await db
        .select()
        .from(workspaceTermination)
        .where(eq(workspaceTermination.workspaceId, sandbox.id)),
    ).toHaveLength(0);
    expect((await caller(userId).get({ sandboxId: sandbox.id })).deleted).toBe(true);
  },
);

integration("#5 a signed E2B pause webhook settles a sandbox's status and usage", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({ name: "webhook", lifetimeMinutes: 5 });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  const providerId = row!.externalInstanceId.split(":").at(-1)!;
  const event = {
    id: randomUUID(),
    version: "v2",
    type: "sandbox.lifecycle.paused",
    timestamp: new Date(Date.now() + 1_000).toISOString(),
    eventData: {},
    event_category: "lifecycle",
    event_label: "pause",
    sandbox_id: providerId,
    sandbox_execution_id: randomUUID(),
    sandbox_template_id: "base",
    sandbox_build_id: "b",
    sandbox_team_id: randomUUID(),
  };
  const rawBody = JSON.stringify(event);
  const signature = createHash("sha256")
    .update(WEBHOOK_SECRET + rawBody)
    .digest("base64")
    .replace(/=+$/, "");
  const result = await internalRouter
    .createCaller({
      internalApiKey: process.env.INTERNAL_API_KEY,
      e2bSignature: signature,
    } as unknown as Context)
    .processE2bWebhook({ ...event, rawBody } as never);
  expect((result as { updated: unknown[] }).updated).toHaveLength(1);
  expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("paused");
  const sessions = await db
    .select()
    .from(usageSession)
    .where(eq(usageSession.workspaceId, sandbox.id));
  expect(sessions[0]!.stoppedAt).not.toBeNull();
});

integration("#5 a signed Boat archive webhook pauses a Boat sandbox", async () => {
  await terminateAll(userId);
  const sandbox = await caller(userId).create({
    provider: "boat",
    name: "boat-webhook",
    lifetimeMinutes: 5,
  });
  const [row] = await db.select().from(workspace).where(eq(workspace.id, sandbox.id));
  expect(row!.externalInstanceId).toStartWith("sandbox:boat:");
  const boxId = row!.externalInstanceId.split(":").at(-1)!;
  const event = {
    id: randomUUID(),
    type: "box.archived",
    createdAt: new Date(Date.now() + 1_000).toISOString(),
    data: { box: { id: boxId } },
  };
  const rawBody = JSON.stringify(event);
  const delivery = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${delivery}.${timestamp}.${rawBody}`).digest("hex")}`;
  const result = await internal().processBoatWebhook({
    ...event,
    rawBody,
    delivery,
    timestamp,
    signature,
  } as never);
  expect((result as { updated: unknown[] }).updated).toHaveLength(1);
  expect((await caller(userId).get({ sandboxId: sandbox.id })).status).toBe("paused");
});

integration("#6 concurrent creates cannot exceed the plan's workspace limit", async () => {
  await terminateAll(userId);
  workspaceLimit = 1;
  try {
    const results = await Promise.allSettled(
      [1, 2, 3].map((index) =>
        caller(userId).create({ name: `race-${index}`, lifetimeMinutes: 5 }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  } finally {
    workspaceLimit = 2;
    await terminateAll(userId);
  }
});

const handleOf = async (id: string) =>
  (await db.select().from(workspace).where(eq(workspace.id, id)))[0]!.externalInstanceId;

integration(
  "#4 reconcile never clears a provider handle on the provider's word alone",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "reconcile", lifetimeMinutes: 5 });
    const handle = await handleOf(sandbox.id);
    providerStates.set(handle.split(":").at(-1)!, "terminated");
    const seen = await caller(userId).get({ sandboxId: sandbox.id });
    // Billing stops, but deletion is only recorded once cleanup confirms it.
    expect(seen.status).toBe("terminated");
    expect(seen.deleted).toBe(false);
    expect(await handleOf(sandbox.id)).toBe(handle);
    expect(
      await db
        .select()
        .from(workspaceTermination)
        .where(eq(workspaceTermination.workspaceId, sandbox.id)),
    ).toHaveLength(1);
  },
);

integration(
  "#5 terminate reports deletion only after the provider confirms it",
  async () => {
    await terminateAll(userId);
    const sandbox = await caller(userId).create({ name: "confirm", lifetimeMinutes: 5 });
    acceptOnlyDestroys = true;
    try {
      await expect(caller(userId).terminate({ sandboxId: sandbox.id })).rejects.toThrow();
      expect((await caller(userId).get({ sandboxId: sandbox.id })).deleted).toBe(false);
      expect(await handleOf(sandbox.id)).not.toBe("");
      expect(
        await db
          .select()
          .from(workspaceTermination)
          .where(eq(workspaceTermination.workspaceId, sandbox.id)),
      ).toHaveLength(1);
    } finally {
      acceptOnlyDestroys = false;
    }
    // Once the provider reports it gone, a retry confirms and completes cleanup.
    providerStates.set((await handleOf(sandbox.id)).split(":").at(-1)!, "terminated");
    expect(await caller(userId).terminate({ sandboxId: sandbox.id })).toMatchObject({
      deleted: true,
    });
    expect(await handleOf(sandbox.id)).toBe("");
  },
  60_000,
);

integration("#4 AWS status errors are failures, not deletions", async () => {
  const { createAwsSandboxTransport } = await import("../providers/aws/sandbox");
  const { AwsProvider } = await import("../providers/aws");
  const denied = Object.assign(
    new Error("User is not authorized to perform: ecs:DescribeServices"),
    {
      name: "AccessDeniedException",
    },
  );
  const spy = spyOn(AwsProvider.prototype, "getStatus").mockRejectedValue(denied);
  try {
    await expect(createAwsSandboxTransport("aws-provider").info("{}")).rejects.toThrow(
      /not authorized/,
    );
  } finally {
    spy.mockRestore();
  }
});
