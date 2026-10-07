import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, db, eq, inArray, isNull } from "@gitterm/db";
import { apiToken, user } from "@gitterm/db/schema/auth";
import { bot } from "@gitterm/db/schema/bot";
import { botsRouter } from "./bots";
import { verifyApiToken } from "../service/auth/api-token";
import type { Context } from "../context";
import {
  usageSession,
  volume,
  workspace,
  workspaceTermination,
} from "@gitterm/db/schema/workspace";
import { agentRun } from "@gitterm/db/schema/agent-run";
import { agentType, cloudProvider, image } from "@gitterm/db/schema/cloud";
import { router } from "../index";
import { workspaceRouter } from "./workspace/managment";
import { runRouter } from "./run";
import { requestBotDeletion } from "../service/bot-deletion";
import { reserveWorkspace, settleWorkspaceProvisioning } from "../service/workspace-provisioning";
import {
  processWorkspaceTermination,
  retryWorkspaceTerminations,
} from "../service/workspace-termination";
import { railwayProvider } from "../providers/railway";
import { AwsProvider } from "../providers/aws";
import * as proxyCache from "../service/proxy-cache";
import * as coordination from "../service/coordination";
import * as billing from "../billing";
import {
  updateWorkspaceByIdAndInvalidate,
  updateWorkspaceByIdReturningAndInvalidate,
  updateWorkspaceStatusAndInvalidate,
} from "../service/workspace-mutations";

// Only run against a disposable database with the current schema; never infer permission
// to mutate the developer's configured database from DATABASE_URL alone.
const testUrl = process.env.BOT_DATABASE_TEST_URL;
if (testUrl && testUrl !== process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must equal the explicit disposable BOT_DATABASE_TEST_URL");
const integration = testUrl ? test : test.skip;
const userId = `bot-test-${randomUUID()}`;
const otherId = `bot-other-${randomUUID()}`;
const catalogIds: string[] = [];
const runtimeApi = router({ workspace: workspaceRouter, run: runRouter });
const caller = (id: string) =>
  botsRouter.createCaller({ session: { user: { id } } } as unknown as Context);
const settings = {
  name: "Concurrency test",
  platform: "slack" as const,
  repo: "https://github.com/acme/app",
  model: "anthropic/sonnet",
  credential: null,
  connections: [],
  provider: null,
  githubAccess: "connection" as const,
  channels: [],
  allowedUsers: [],
  allowGuests: false,
  instructions: null,
  setup: null,
};
const localMocks: { mockRestore(): void }[] = [];
beforeAll(async () => {
  if (!testUrl) return;
  // Exercise the real DB/transactions without touching a configured Redis or provider account.
  localMocks.push(
    spyOn(proxyCache, "invalidateProxyCacheForWorkspace").mockResolvedValue(),
    spyOn(proxyCache, "invalidateAllProxyRouteAccessCache").mockResolvedValue(),
    spyOn(coordination, "coordinate").mockRejectedValue(new Error("Redis is not used in DB tests")),
    spyOn(billing, "getBilling").mockResolvedValue(billing.unlimitedBilling),
  );
  await db.insert(user).values(
    [userId, otherId].map((id) => ({
      id,
      name: "Test",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});
afterAll(async () => {
  if (!testUrl) return;
  await db.delete(user).where(eq(user.id, userId));
  await db.delete(user).where(eq(user.id, otherId));
  for (const id of catalogIds) {
    await db.delete(agentType).where(eq(agentType.id, id));
    await db.delete(cloudProvider).where(eq(cloudProvider.id, id));
  }
  for (const localMock of localMocks) localMock.mockRestore();
});

async function sandboxValues(
  botId: string | null,
  overrides: Partial<typeof workspace.$inferInsert> = {},
) {
  const typeId = randomUUID();
  const providerId = randomUUID();
  const imageId = randomUUID();
  catalogIds.push(typeId, providerId);
  await db.insert(agentType).values({ id: typeId, key: typeId, name: typeId, serverOnly: true });
  await db
    .insert(cloudProvider)
    .values({ id: providerId, name: providerId, providerKey: "railway" });
  await db.insert(image).values({ id: imageId, name: imageId, imageId, agentTypeId: typeId });
  const id = randomUUID();
  return {
    id,
    userId,
    botId,
    imageId,
    cloudProviderId: providerId,
    externalInstanceId: "",
    domain: `${id}.example.test`,
    status: "pending" as const,
    startedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } satisfies typeof workspace.$inferInsert;
}

async function savedIdentity() {
  const created = await caller(userId).create(settings);
  const [identity] = await db.select().from(bot).where(eq(bot.id, created.bot.id));
  return { ...created, identity: identity! };
}

integration(
  "large bot deletions revoke every workspace and leave bounded cleanup batches",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, {
      status: "running",
      externalInstanceId: "service-0",
    });
    const rows = Array.from({ length: 6 }, (_, index) => ({
      ...values,
      id: randomUUID(),
      domain: `${randomUUID()}.example.test`,
      externalInstanceId: `service-${index}`,
    }));
    await db.insert(workspace).values(rows);
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockResolvedValue();
    try {
      expect(await caller(userId).delete({ id: identity.id })).toEqual({
        success: true,
        terminated: 5,
        failed: 1,
      });
      expect(teardown).toHaveBeenCalledTimes(5);
      const states = await db
        .select({ status: workspace.status })
        .from(workspace)
        .where(
          inArray(
            workspace.id,
            rows.map(({ id }) => id),
          ),
        );
      expect(states.every(({ status }) => status === "terminated")).toBe(true);
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(teardown).toHaveBeenCalledTimes(6);
    } finally {
      teardown.mockRestore();
    }
  },
);

integration(
  "a failed publication retains teardown handles and rolls back partial usage",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, { persistent: true });
    await reserveWorkspace(values, identity);
    await expect(
      settleWorkspaceProvisioning(
        { ...values, externalInstanceId: "failed-publication", status: "running" },
        {
          workspaceId: values.id,
          userId,
          cloudProviderId: values.cloudProviderId,
          externalVolumeId: "publication-volume",
          mountPath: "/workspace",
        },
        identity,
        async (tx) => {
          await tx
            .insert(usageSession)
            .values({ workspaceId: values.id, userId, startedAt: new Date() });
          throw new Error("setup record could not be published");
        },
      ),
    ).rejects.toThrow("setup record could not be published");
    const row = await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) });
    expect(row?.status).toBe("terminated");
    expect(row?.externalInstanceId).toBe("failed-publication");
    expect(
      await db.query.usageSession.findFirst({ where: eq(usageSession.workspaceId, values.id) }),
    ).toBeUndefined();
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockResolvedValue();
    try {
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(teardown).toHaveBeenCalledWith("failed-publication", "publication-volume");
      await caller(userId).delete({ id: identity.id });
    } finally {
      teardown.mockRestore();
    }
  },
);

for (const operation of ["ensureRunning", "restartWorkspace"] as const) {
  integration(`${operation} in flight cannot revive a deleted bot's workspace`, async () => {
    const { identity, token } = await savedIdentity();
    const values = await sandboxValues(identity.id, {
      externalInstanceId: "restart-race",
      status: "paused",
    });
    await db.insert(workspace).values(values);
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockResolvedValue();
    const resume = spyOn(railwayProvider, "resumeWorkspace").mockImplementation(async () => {
      await caller(userId).delete({ id: identity.id });
    });
    const api = runtimeApi.createCaller({
      session: null,
      bearerToken: token,
    } as unknown as Context);
    try {
      await expect(api.workspace[operation]({ workspaceId: values.id })).rejects.toThrow(
        "Workspace restart was cancelled by deletion",
      );
      const row = await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) });
      expect(row?.status).toBe("terminated");
      expect(row?.externalInstanceId).toBe("");
      expect(
        await db.query.usageSession.findFirst({ where: eq(usageSession.workspaceId, values.id) }),
      ).toBeUndefined();
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 0, failed: 0 });
    } finally {
      teardown.mockRestore();
      resume.mockRestore();
    }
  });
}

integration(
  "simultaneous rotations leave exactly one tracked valid token; deletion revokes every token",
  async () => {
    const owner = caller(userId);
    const created = await owner.create(settings);
    const rotated = await Promise.all(
      Array.from({ length: 12 }, () => owner.rotateToken({ id: created.bot.id })),
    );
    const verified = await Promise.all(rotated.map((result) => verifyApiToken(result.token)));
    expect(verified.filter(Boolean)).toHaveLength(1);
    const [row] = await db.select().from(bot).where(eq(bot.id, created.bot.id));
    expect(verified.find(Boolean)?.tokenId).toBe(row!.apiTokenId!);
    expect(await verifyApiToken(created.token)).toBeNull();
    expect(
      await db
        .select()
        .from(apiToken)
        .where(and(eq(apiToken.botId, created.bot.id), isNull(apiToken.revokedAt))),
    ).toHaveLength(1);
    await owner.delete({ id: created.bot.id });
    expect(
      (await Promise.all(rotated.map((result) => verifyApiToken(result.token)))).every(
        (value) => value === null,
      ),
    ).toBe(true);
  },
);

integration("a rotation racing deletion cannot leave a usable orphan", async () => {
  const owner = caller(userId);
  for (let attempt = 0; attempt < 6; attempt++) {
    const created = await owner.create(settings);
    const [rotated, deleted] = await Promise.allSettled([
      owner.rotateToken({ id: created.bot.id }),
      owner.delete({ id: created.bot.id }),
    ]);
    expect(deleted.status).toBe("fulfilled");
    if (rotated.status === "fulfilled")
      expect(await verifyApiToken(rotated.value.token)).toBeNull();
    expect(await verifyApiToken(created.token)).toBeNull();
    expect(
      await db
        .select()
        .from(apiToken)
        .where(and(eq(apiToken.botId, created.bot.id), isNull(apiToken.revokedAt))),
    ).toHaveLength(0);
  }
});

integration("another account cannot rotate or delete a saved bot", async () => {
  const created = await caller(userId).create(settings);
  await expect(caller(otherId).rotateToken({ id: created.bot.id })).rejects.toThrow(
    "Bot not found",
  );
  await expect(caller(otherId).delete({ id: created.bot.id })).rejects.toThrow("Bot not found");
  expect((await verifyApiToken(created.token))?.botId).toBe(created.bot.id);
  await caller(userId).delete({ id: created.bot.id });
});

integration(
  "two bots of the same owner cannot enumerate, read or operate each other's or personal workspaces",
  async () => {
    const owner = caller(userId);
    const first = await owner.create(settings);
    const second = await owner.create({
      ...settings,
      name: "Other bot",
      connections: ["Production"],
    });
    const typeId = randomUUID();
    const providerId = randomUUID();
    const imageId = randomUUID();
    catalogIds.push(typeId, providerId);
    await db.insert(agentType).values({ id: typeId, key: typeId, name: typeId, serverOnly: true });
    await db.insert(cloudProvider).values({ id: providerId, name: providerId });
    await db.insert(image).values({ id: imageId, name: imageId, imageId, agentTypeId: typeId });
    const workspaceIds = [randomUUID(), randomUUID(), randomUUID()];
    await db.insert(workspace).values(
      workspaceIds.map((id, index) => ({
        id,
        userId,
        botId: [first.bot.id, second.bot.id, null][index],
        imageId,
        cloudProviderId: providerId,
        externalInstanceId: id,
        domain: `${id}.example.test`,
        status: "running" as const,
        serverOnly: true,
        startedAt: new Date(),
        updatedAt: new Date(),
        // Forged metadata must not grant delegated ownership.
        metadata: { "gitterm-bot-id": first.bot.id },
      })),
    );
    const runIds = [randomUUID(), randomUUID()];
    await db.insert(agentRun).values(
      runIds.map((id, index) => ({
        id,
        workspaceId: workspaceIds[index]!,
        idempotencyKey: id,
        requestHash: id,
        nativeMessageId: id,
        title: "Agent run",
        status: "completed" as const,
      })),
    );
    const api = runtimeApi.createCaller({
      session: null,
      bearerToken: first.token,
    } as unknown as Context);
    try {
      const own = await api.workspace.getWorkspace({ workspaceId: workspaceIds[0]! });
      expect(own.workspace?.id).toBe(workspaceIds[0]!);
      const listed = await api.workspace.listWorkspaces({ limit: 100, offset: 0, status: "all" });
      expect(listed.workspaces.map((row) => row.id)).toEqual([workspaceIds[0]!]);
      for (const id of workspaceIds.slice(1)) {
        await expect(api.workspace.getWorkspace({ workspaceId: id })).rejects.toThrow(
          "Workspace not found",
        );
        await expect(api.workspace.ensureRunning({ workspaceId: id })).rejects.toThrow(
          "Workspace not found",
        );
      }
      expect((await api.run.get({ workspaceId: workspaceIds[0]!, runId: runIds[0]! })).id).toBe(
        runIds[0]!,
      );
      await expect(
        api.run.get({ workspaceId: workspaceIds[1]!, runId: runIds[1]! }),
      ).rejects.toThrow("Workspace not found");
      await expect(
        api.run.create({
          workspaceId: workspaceIds[1]!,
          idempotencyKey: "attack",
          prompt: "read secrets",
        }),
      ).rejects.toThrow("Workspace not found");
    } finally {
      // These ownership fixtures do not represent real provider resources.
      await db.delete(workspace).where(inArray(workspace.id, workspaceIds));
      await owner.delete({ id: first.bot.id });
      await owner.delete({ id: second.bot.id });
    }
  },
);

integration("deleting a bot terminates its sandboxes, and only those", async () => {
  const owner = caller(userId);
  const created = await owner.create({ ...settings, name: "Sandbox owner" });
  const typeId = randomUUID();
  const providerId = randomUUID();
  const imageId = randomUUID();
  catalogIds.push(typeId, providerId);
  await db.insert(agentType).values({ id: typeId, key: typeId, name: typeId, serverOnly: true });
  await db
    .insert(cloudProvider)
    .values({ id: providerId, name: providerId, providerKey: "railway" });
  await db.insert(image).values({ id: imageId, name: imageId, imageId, agentTypeId: typeId });
  const [own, unrelated, forged] = [randomUUID(), randomUUID(), randomUUID()];
  await db.insert(workspace).values(
    [own, unrelated, forged].map((id) => ({
      id,
      userId,
      botId: id === own ? created.bot.id : null,
      imageId,
      cloudProviderId: providerId,
      // Nothing remote to tear down, so no provider is called.
      externalInstanceId: "",
      domain: `${id}.example.test`,
      status: "paused" as const,
      serverOnly: true,
      startedAt: new Date(),
      updatedAt: new Date(),
      // Only the server-assigned botId counts; a tag anyone can write must not.
      metadata: (id === forged ? { "gitterm-bot-id": created.bot.id } : {}) as Record<
        string,
        string
      >,
    })),
  );
  expect(await owner.sandboxCount({ id: created.bot.id })).toBe(1);
  expect(await owner.delete({ id: created.bot.id })).toEqual({
    success: true,
    terminated: 1,
    failed: 0,
  });
  const rows = await db
    .select({ id: workspace.id, status: workspace.status })
    .from(workspace)
    .where(inArray(workspace.id, [own, unrelated, forged]));
  expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
    [own]: "terminated",
    [unrelated]: "paused",
    [forged]: "paused",
  });
});

integration(
  "an authenticated create cannot reserve a workspace after its bot was deleted",
  async () => {
    const { identity, token } = await savedIdentity();
    const values = await sandboxValues(identity.id);
    await requestBotDeletion(userId, identity.id);
    await expect(reserveWorkspace(values, identity)).rejects.toThrow(
      "Bot identity has been revoked",
    );
    expect(
      await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) }),
    ).toBeUndefined();
    expect(await verifyApiToken(token)).toBeNull();
  },
);

integration(
  "reservation racing deletion is either rejected or included in durable cleanup",
  async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const { identity } = await savedIdentity();
      const values = await sandboxValues(identity.id);
      const [reserved, deleted] = await Promise.allSettled([
        reserveWorkspace(values, identity),
        requestBotDeletion(userId, identity.id),
      ]);
      expect(deleted.status).toBe("fulfilled");
      const row = await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) });
      if (reserved.status === "fulfilled") {
        expect(row?.status).toBe("terminated");
        expect(
          await db.query.workspaceTermination.findFirst({
            where: eq(workspaceTermination.workspaceId, values.id),
          }),
        ).toBeDefined();
        expect(await processWorkspaceTermination(userId, values.id)).toBe(true);
      } else {
        expect(row).toBeUndefined();
      }
    }
  },
);

integration(
  "late persistent provisioning cannot resurrect a deleted bot and requeues its resources",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, { persistent: true });
    await reserveWorkspace(values, identity);
    // The first deletion sees no provider handle yet and finishes local cleanup.
    expect(await caller(userId).delete({ id: identity.id })).toEqual({
      success: true,
      terminated: 1,
      failed: 0,
    });
    let published = false;
    const externalVolumeId = randomUUID();
    const settled = await settleWorkspaceProvisioning(
      { ...values, externalInstanceId: "late-service", status: "running" },
      {
        workspaceId: values.id,
        userId,
        cloudProviderId: values.cloudProviderId,
        externalVolumeId,
        mountPath: "/workspace",
      },
      identity,
      async () => {
        published = true;
      },
    );
    expect(settled.cancelled).toBe(true);
    expect(settled.workspace.status).toBe("terminated");
    expect(published).toBe(false);
    expect(settled.volume?.externalVolumeId).toBe(externalVolumeId);
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockResolvedValue();
    try {
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(teardown).toHaveBeenCalledWith("late-service", externalVolumeId);
      expect(
        await db.query.volume.findFirst({ where: eq(volume.workspaceId, values.id) }),
      ).toBeUndefined();
      expect(
        await db.query.workspaceTermination.findFirst({
          where: eq(workspaceTermination.workspaceId, values.id),
        }),
      ).toBeUndefined();
      expect(
        (await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) }))
          ?.externalInstanceId,
      ).toBe("");
    } finally {
      teardown.mockRestore();
    }
  },
);

integration(
  "cleanup survives interruption between bot deletion and provider dispatch",
  async () => {
    const { identity, token } = await savedIdentity();
    const values = await sandboxValues(identity.id, {
      externalInstanceId: "interrupted-service",
      status: "running",
    });
    await db.insert(workspace).values(values);
    await db.insert(usageSession).values({ workspaceId: values.id, userId, startedAt: new Date() });
    const ids = await requestBotDeletion(userId, identity.id);
    // No immediate dispatcher ran: this is exactly the state left by a stopped API process.
    expect(ids).toEqual([values.id]);
    expect(await verifyApiToken(token)).toBeNull();
    expect(
      (await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) }))?.status,
    ).toBe("terminated");
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockResolvedValue();
    try {
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(teardown).toHaveBeenCalledWith("interrupted-service", undefined);
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 0, failed: 0 });
      expect(
        (await db.query.usageSession.findFirst({ where: eq(usageSession.workspaceId, values.id) }))
          ?.stoppedAt,
      ).not.toBeNull();
    } finally {
      teardown.mockRestore();
    }
  },
);

integration("provider failure retains handles and volume for an automatic retry", async () => {
  const { identity } = await savedIdentity();
  const values = await sandboxValues(identity.id, {
    externalInstanceId: "retry-service",
    persistent: true,
    status: "running",
  });
  await db.insert(workspace).values(values);
  await db.insert(volume).values({
    workspaceId: values.id,
    userId,
    cloudProviderId: values.cloudProviderId,
    externalVolumeId: "retry-volume",
    mountPath: "/workspace",
  });
  const teardown = spyOn(railwayProvider, "terminateWorkspace").mockRejectedValue(
    new Error("temporary provider failure"),
  );
  const logs = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await caller(userId).delete({ id: identity.id })).toEqual({
      success: true,
      terminated: 0,
      failed: 1,
    });
    expect(
      (await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) }))
        ?.externalInstanceId,
    ).toBe("retry-service");
    expect(
      (await db.query.volume.findFirst({ where: eq(volume.workspaceId, values.id) }))
        ?.externalVolumeId,
    ).toBe("retry-volume");
    expect(
      (
        await db.query.workspaceTermination.findFirst({
          where: eq(workspaceTermination.workspaceId, values.id),
        })
      )?.leaseUntil,
    ).toBeNull();
    await expect(caller(otherId).delete({ id: identity.id })).rejects.toThrow("Bot not found");
    teardown.mockResolvedValue();
    expect(await caller(userId).delete({ id: identity.id })).toEqual({
      success: true,
      terminated: 1,
      failed: 0,
    });
    expect(teardown).toHaveBeenLastCalledWith("retry-service", "retry-volume");
    expect(await retryWorkspaceTerminations()).toEqual({ terminated: 0, failed: 0 });
  } finally {
    teardown.mockRestore();
    logs.mockRestore();
  }
});

integration(
  "expired cleanup claims are recovered, but active claims are not dispatched twice",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id);
    await reserveWorkspace(values, identity);
    await requestBotDeletion(userId, identity.id);
    await db
      .update(workspaceTermination)
      .set({ leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(workspaceTermination.workspaceId, values.id));
    expect(await retryWorkspaceTerminations()).toEqual({ terminated: 0, failed: 0 });
    expect(await processWorkspaceTermination(userId, values.id)).toBe(false);
    await db
      .update(workspaceTermination)
      .set({ leaseUntil: new Date(Date.now() - 60_000) })
      .where(eq(workspaceTermination.workspaceId, values.id));
    expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
  },
);

integration(
  "an old cleanup cannot erase handles or dequeue a new provisioning generation",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, { externalInstanceId: "early-handle" });
    await reserveWorkspace(values, identity);
    await requestBotDeletion(userId, identity.id);
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockImplementation(async () => {
      await settleWorkspaceProvisioning(
        { ...values, externalInstanceId: "late-handle", status: "running" },
        null,
        identity,
      );
    });
    try {
      expect(await processWorkspaceTermination(userId, values.id)).toBe(false);
      expect(
        (await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) }))
          ?.externalInstanceId,
      ).toBe("late-handle");
      expect(
        await db.query.workspaceTermination.findFirst({
          where: eq(workspaceTermination.workspaceId, values.id),
        }),
      ).toBeDefined();
      teardown.mockResolvedValue();
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(teardown).toHaveBeenLastCalledWith("late-handle", undefined);
    } finally {
      teardown.mockRestore();
    }
  },
);

integration(
  "bot deletion awaits AWS cleanup rather than reporting background success",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, {
      externalInstanceId: "aws-handle",
      status: "running",
    });
    await db
      .update(cloudProvider)
      .set({ providerKey: "aws" })
      .where(eq(cloudProvider.id, values.cloudProviderId));
    await db.insert(workspace).values(values);
    const teardown = spyOn(AwsProvider.prototype, "terminateWorkspace").mockRejectedValue(
      new Error("AWS cleanup failed"),
    );
    const logs = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await caller(userId).delete({ id: identity.id })).toEqual({
        success: true,
        terminated: 0,
        failed: 1,
      });
      teardown.mockResolvedValue();
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(teardown).toHaveBeenCalledWith("aws-handle", undefined);
    } finally {
      teardown.mockRestore();
      logs.mockRestore();
    }
  },
);

integration(
  "successful provisioning commits volumes and usage before deletion can proceed",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, { persistent: true });
    await reserveWorkspace(values, identity);
    const settled = await settleWorkspaceProvisioning(
      { ...values, externalInstanceId: "ready-service", status: "running" },
      {
        workspaceId: values.id,
        userId,
        cloudProviderId: values.cloudProviderId,
        externalVolumeId: "ready-volume",
        mountPath: "/workspace",
      },
      identity,
      async (tx) => {
        await tx
          .insert(usageSession)
          .values({ workspaceId: values.id, userId, startedAt: new Date() });
      },
    );
    expect(settled.cancelled).toBe(false);
    expect(settled.workspace.status).toBe("running");
    expect(settled.volume?.externalVolumeId).toBe("ready-volume");
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockResolvedValue();
    try {
      expect(await caller(userId).delete({ id: identity.id })).toEqual({
        success: true,
        terminated: 1,
        failed: 0,
      });
      expect(teardown).toHaveBeenCalledWith("ready-service", "ready-volume");
      expect(
        (await db.query.usageSession.findFirst({ where: eq(usageSession.workspaceId, values.id) }))
          ?.stoppedAt,
      ).not.toBeNull();
    } finally {
      teardown.mockRestore();
    }
  },
);

integration(
  "late pauses, restarts and provider status updates cannot undo termination",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id);
    await reserveWorkspace(values, identity);
    await requestBotDeletion(userId, identity.id);
    await updateWorkspaceByIdAndInvalidate(values.id, { status: "paused" });
    expect(
      await updateWorkspaceByIdReturningAndInvalidate(values.id, { status: "pending" }),
    ).toEqual([]);
    expect(
      await updateWorkspaceStatusAndInvalidate(eq(workspace.id, values.id), { status: "running" }),
    ).toEqual([]);
    expect(
      (await db.query.workspace.findFirst({ where: eq(workspace.id, values.id) }))?.status,
    ).toBe("terminated");
    expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
  },
);

integration(
  "another bot of the same owner and another user's sandbox are not deleted",
  async () => {
    const first = await savedIdentity();
    const second = await savedIdentity();
    const own = await sandboxValues(first.identity.id, { status: "paused" });
    const sibling = await sandboxValues(second.identity.id, { status: "paused" });
    const foreign = await sandboxValues(first.identity.id, { userId: otherId, status: "paused" });
    await db.insert(workspace).values([own, sibling, foreign]);
    expect(await caller(userId).sandboxCount({ id: first.identity.id })).toBe(1);
    expect(await caller(userId).delete({ id: first.identity.id })).toEqual({
      success: true,
      terminated: 1,
      failed: 0,
    });
    expect(
      (await db.query.workspace.findFirst({ where: eq(workspace.id, sibling.id) }))?.status,
    ).toBe("paused");
    expect(
      (await db.query.workspace.findFirst({ where: eq(workspace.id, foreign.id) }))?.status,
    ).toBe("paused");
    await caller(userId).delete({ id: second.identity.id });
  },
);

integration(
  "a provider resource already deleted before interruption completes its retry",
  async () => {
    const { identity } = await savedIdentity();
    const values = await sandboxValues(identity.id, {
      externalInstanceId: "already-gone",
      status: "running",
    });
    await db.insert(workspace).values(values);
    await requestBotDeletion(userId, identity.id);
    const teardown = spyOn(railwayProvider, "terminateWorkspace").mockRejectedValue(
      Object.assign(new Error("resource gone"), { status: 404 }),
    );
    try {
      expect(await retryWorkspaceTerminations()).toEqual({ terminated: 1, failed: 0 });
      expect(
        await db.query.workspaceTermination.findFirst({
          where: eq(workspaceTermination.workspaceId, values.id),
        }),
      ).toBeUndefined();
    } finally {
      teardown.mockRestore();
    }
  },
);
