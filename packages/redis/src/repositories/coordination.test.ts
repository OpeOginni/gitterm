import { afterAll, expect, test } from "bun:test";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { CoordinationRepository } from "./coordination";

// Opt in with an isolated Redis instance. Never flush an existing development/production Redis.
const url = process.env.REDIS_COORDINATION_TEST_URL;
const redis = url ? new Redis(url, { maxRetriesPerRequest: 0 }) : undefined;
const repository = redis ? new CoordinationRepository(redis) : undefined;
const integration = url ? test : test.skip;
afterAll(async () => {
  await redis?.quit();
});

integration(
  "concurrent bot claims pick exactly one owner; stale release cannot remove a newer token's claim",
  async () => {
    const bot = randomUUID();
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, index) => repository!.claimBot(bot, "token", `lease${index}`)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = `lease${claims.findIndex(Boolean)}`;
    // The owner renews; anyone else is refused until it releases or expires.
    expect(await repository!.claimBot(bot, "token", winner)).toBe(true);
    await repository!.releaseBot(bot, "token", "other");
    expect(await repository!.claimBot(bot, "token", "other")).toBe(false);
    // Revoking the old token frees the claim for a rotated one; a late revoke can't undo it.
    await repository!.revokeBot(bot, "token");
    expect(await repository!.claimBot(bot, "new-token", "new-lease")).toBe(true);
    await repository!.revokeBot(bot, "token");
    expect(await repository!.claimBot(bot, "token", winner)).toBe(false);
    await repository!.releaseBot(bot, "new-token", "new-lease");
  },
);

integration("a bot claim expires after a crash", async () => {
  const short = new CoordinationRepository(redis!, { botLeaseMs: 50, mcpCooldownMs: 10 });
  const id = randomUUID();
  expect(await short.claimBot(id, "old-token", "old-lease")).toBe(true);
  expect(await short.claimBot(id, "new-token", "new-lease")).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(await short.claimBot(id, "new-token", "new-lease")).toBe(true);
  await short.releaseBot(id, "new-token", "new-lease");
});

integration("a connection is tested at most once per cooldown", async () => {
  const connection = randomUUID();
  expect(await repository!.allowMcpTest(randomUUID(), connection)).toBe(true);
  expect(await repository!.allowMcpTest(randomUUID(), connection)).toBe(false);
});

integration("an owner gets six tests a minute across connections", async () => {
  const user = randomUUID();
  for (let i = 0; i < 6; i++) {
    expect(await repository!.allowMcpTest(user, randomUUID())).toBe(true);
  }
  expect(await repository!.allowMcpTest(user, randomUUID())).toBe(false);
});
