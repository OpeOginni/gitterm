import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, db, eq, isNull } from "@gitterm/db";
import { apiToken, user } from "@gitterm/db/schema/auth";
import { bot } from "@gitterm/db/schema/bot";
import { botsRouter } from "./bots";
import { verifyApiToken } from "../service/auth/api-token";
import type { Context } from "../context";
import { workspace } from "@gitterm/db/schema/workspace";
import { agentRun } from "@gitterm/db/schema/agent-run";
import { agentType, cloudProvider, image } from "@gitterm/db/schema/cloud";
import { router } from "../index";
import { workspaceRouter } from "./workspace/managment";
import { runRouter } from "./run";

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
beforeAll(async () => {
  if (!testUrl) return;
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
});

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
      await owner.delete({ id: first.bot.id });
      await owner.delete({ id: second.bot.id });
    }
  },
);
