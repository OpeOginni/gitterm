import { getRedisClient, type RedisClient } from "../client";
import { RedisKeys } from "../keys";

const CLAIM_OR_RENEW = `
local current = redis.call('GET', KEYS[1])
if current and current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1`;
const RELEASE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;
const RELEASE_FOR_TOKEN = `
local current = redis.call('GET', KEYS[1])
if current and string.sub(current, 1, string.len(ARGV[1])) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

// One test per connection every 30 seconds, and six per owner a minute. Tests are bounded to
// 60 seconds, so this also bounds how many can run at once.
const ALLOW_MCP_TEST = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('PEXPIRE', KEYS[2], 60000) end
if count > 6 then return 0 end
redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return 1`;

/** Coordination only: callers must fail closed on errors. Durable identity stays in Postgres. */
export class CoordinationRepository {
  constructor(
    private readonly redis: Pick<RedisClient, "eval"> = getRedisClient(),
    private readonly timing = { botLeaseMs: 90_000, mcpCooldownMs: 30_000 },
  ) {}
  async claimBot(botId: string, tokenId: string, leaseId: string): Promise<boolean> {
    return (
      (await this.redis.eval(
        CLAIM_OR_RENEW,
        1,
        RedisKeys.botRuntimeLease(botId),
        `${tokenId}:${leaseId}`,
        String(this.timing.botLeaseMs),
      )) === 1
    );
  }
  async releaseBot(botId: string, tokenId: string, leaseId: string): Promise<void> {
    await this.redis.eval(
      RELEASE_IF_OWNER,
      1,
      RedisKeys.botRuntimeLease(botId),
      `${tokenId}:${leaseId}`,
    );
  }
  async revokeBot(botId: string, tokenId: string): Promise<void> {
    // A delayed rotation/deletion cleanup cannot remove a newer token's runtime claim.
    await this.redis.eval(RELEASE_FOR_TOKEN, 1, RedisKeys.botRuntimeLease(botId), `${tokenId}:`);
  }
  async allowMcpTest(userId: string, connectionId: string): Promise<boolean> {
    return (
      (await this.redis.eval(
        ALLOW_MCP_TEST,
        2,
        RedisKeys.mcpTestCooldown(connectionId),
        RedisKeys.mcpTestRate(userId),
        String(this.timing.mcpCooldownMs),
      )) === 1
    );
  }
}
