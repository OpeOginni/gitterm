import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
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
    },
    async preview(_id: string, port: number) {
      return { url: `https://${port}-fake.e2b.app`, headers: { "e2b-traffic-access-token": "t" } };
    },
  };
  mocks.push(
    spyOn(transportModule, "managedSandboxTransport").mockResolvedValue(fake as never),
    spyOn(billing, "getBilling").mockResolvedValue({
      ...billing.unlimitedBilling,
      enabled: true,
      getEntitlements: async () => ({ ...UNLIMITED_ENTITLEMENTS, maxWorkspaces: 2 }),
      checkRunAllowance: async (id: string, input: unknown) => {
        allowanceChecks.push({ id, input });
        return { allowed: true };
      },
    }),
    spyOn(activity, "recordWorkspaceActivity").mockResolvedValue(),
    spyOn(proxyCache, "invalidateProxyCacheForWorkspace").mockResolvedValue(),
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
