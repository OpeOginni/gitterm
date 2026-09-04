import { randomUUID } from "node:crypto";
import { getRedisClient, RedisKeys, type RedisClient } from "@gitterm/redis";

/**
 * Coordination between `apps/server` replicas for agent runs.
 *
 * - One replica owns a workspace's OpenCode event stream at a time, decided by
 *   a Redis lease keyed on the workspace. Leases expire, so a crashed owner is
 *   replaced by whichever replica sweeps next.
 * - Run events and watcher control messages fan out over Redis pub/sub so an
 *   SSE subscriber or a `respond` call can land on any replica.
 *
 * When Redis is unreachable every replica behaves as if it were the only one:
 * that risks duplicate (idempotent) writers, never a stalled run.
 */
export const INSTANCE_ID = randomUUID();

export const LEASE_TTL_MS = 90_000;
const RUN_LIFECYCLE_CHANNEL = "gitterm:run-lifecycle";
const WATCH_CONTROL_CHANNEL = "gitterm:run-watch";

function log(level: "info" | "warn", message: string, context: Record<string, unknown> = {}) {
  console[level](`[run-cluster] ${message}`, context);
}

const RENEW_IF_OWNER = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
if redis.call("EXISTS", KEYS[1]) == 0 then
  return redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX") and 1 or 0
end
return 0`;

const RELEASE_IF_OWNER = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

/** True when this watcher now owns (or already owned) the workspace's lease. */
export async function acquireWatcherLease(workspaceId: string, leaseId: string): Promise<boolean> {
  const key = RedisKeys.runWatcherLease(workspaceId);
  try {
    const redis = getRedisClient();
    const set = await redis.set(key, leaseId, "PX", LEASE_TTL_MS, "NX");
    if (set === "OK") return true;
    return (await redis.get(key)) === leaseId;
  } catch (error) {
    log("warn", "lease acquire failed; acting as sole replica", { workspaceId, error });
    return true;
  }
}

/** False when another replica has taken the lease over; the caller must stop watching. */
export async function renewWatcherLease(workspaceId: string, leaseId: string): Promise<boolean> {
  try {
    const renewed = await getRedisClient().eval(
      RENEW_IF_OWNER,
      1,
      RedisKeys.runWatcherLease(workspaceId),
      leaseId,
      String(LEASE_TTL_MS),
    );
    return renewed === 1;
  } catch (error) {
    log("warn", "lease renew failed; keeping the watcher", { workspaceId, error });
    return true;
  }
}

export async function releaseWatcherLease(workspaceId: string, leaseId: string): Promise<void> {
  try {
    await getRedisClient().eval(
      RELEASE_IF_OWNER,
      1,
      RedisKeys.runWatcherLease(workspaceId),
      leaseId,
    );
  } catch (error) {
    log("warn", "lease release failed", { workspaceId, error });
  }
}

export type WatchControl =
  | { type: "track"; workspaceId: string; runId: string }
  | { type: "untrack"; workspaceId: string; runId: string }
  | { type: "refresh"; workspaceId: string; runId: string };

type Envelope<T> = { origin: string; payload: T };

const handlers = new Map<string, Set<(payload: unknown) => void>>();
let subscriber: RedisClient | null = null;

function ensureSubscriber() {
  if (subscriber) return;
  try {
    subscriber = getRedisClient().duplicate();
  } catch (error) {
    log("warn", "pub/sub unavailable; events stay local to this replica", { error });
    return;
  }
  subscriber.on("error", (error) => log("warn", "pub/sub connection error", { error }));
  subscriber.on("message", (channel: string, raw: string) => {
    let envelope: Envelope<unknown>;
    try {
      envelope = JSON.parse(raw) as Envelope<unknown>;
    } catch {
      return;
    }
    if (envelope.origin === INSTANCE_ID) return;
    for (const handler of handlers.get(channel) ?? []) handler(envelope.payload);
  });
  void subscriber
    .subscribe(RUN_LIFECYCLE_CHANNEL, WATCH_CONTROL_CHANNEL)
    .catch((error) => log("warn", "pub/sub subscribe failed", { error }));
}

function subscribeChannel<T>(channel: string, handler: (payload: T) => void): () => void {
  ensureSubscriber();
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  const wrapped = handler as (payload: unknown) => void;
  set.add(wrapped);
  return () => {
    set?.delete(wrapped);
  };
}

function publishChannel<T>(channel: string, payload: T): void {
  const envelope: Envelope<T> = { origin: INSTANCE_ID, payload };
  let redis: RedisClient;
  try {
    redis = getRedisClient();
  } catch {
    return;
  }
  redis.publish(channel, JSON.stringify(envelope)).catch((error) => {
    log("warn", "publish failed", { channel, error });
  });
}

/** Run events from other replicas (own events are emitted locally, not echoed). */
export function onRemoteRunLifecycleEvent<T>(handler: (message: T) => void): () => void {
  return subscribeChannel(RUN_LIFECYCLE_CHANNEL, handler);
}

export function publishRunLifecycleEventRemote<T>(message: T): void {
  publishChannel(RUN_LIFECYCLE_CHANNEL, message);
}

export function onWatchControl(handler: (message: WatchControl) => void): () => void {
  return subscribeChannel(WATCH_CONTROL_CHANNEL, handler);
}

export function publishWatchControl(message: WatchControl): void {
  publishChannel(WATCH_CONTROL_CHANNEL, message);
}
