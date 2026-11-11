/** Counters read from Postgres, Redis and the mock upstreams around a load run. */
import { RedisClient, SQL } from "bun";
import { DATABASE_URL, PORTS, REDIS_URL } from "./config";

let sql: SQL | undefined;
let redis: RedisClient | undefined;

export const db = () => (sql ??= new SQL(DATABASE_URL));
export const cache = () => (redis ??= new RedisClient(REDIS_URL));

export async function closeProbes() {
  await sql?.close();
  redis?.close();
}

/** Calls per Redis command since the server started. */
export async function redisCommands(): Promise<Record<string, number>> {
  const info = String(await cache().send("INFO", ["commandstats"]));
  const out: Record<string, number> = {};
  for (const line of info.split("\n")) {
    const match = line.match(/^cmdstat_([^:]+):calls=(\d+)/);
    if (match) out[match[1]!] = Number(match[2]);
  }
  return out;
}

export type Statement = { query: string; calls: number; meanMs: number; rows: number };

export async function resetStatements() {
  await db()`create extension if not exists pg_stat_statements`;
  await db()`select pg_stat_statements_reset()`;
}

/** Statements run since the last reset, most called first, excluding this probe's own. */
export async function statements(limit = 15): Promise<Statement[]> {
  const rows = await db()`
    select query, calls::int as calls, round(mean_exec_time::numeric, 3)::float as "meanMs", rows::int as rows
    from pg_stat_statements
    where query not ilike '%pg_stat_statements%' and query not ilike 'set %'
    order by calls desc limit ${limit}`;
  return rows.map((row: Statement) => ({
    ...row,
    query: row.query.replace(/\s+/g, " ").slice(0, 400),
  }));
}

export function diff(before: Record<string, number>, after: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(after)) {
    const delta = value - (before[key] ?? 0);
    if (delta > 0) out[key] = delta;
  }
  return out;
}

export type UpstreamStats = Record<string, { connections: number; requests: number }>;

export async function upstreamStats(): Promise<UpstreamStats> {
  return (await (
    await fetch(`http://127.0.0.1:${PORTS.upstream}/__stats`)
  ).json()) as UpstreamStats;
}

export async function resetUpstreamStats() {
  await fetch(`http://127.0.0.1:${PORTS.upstream}/__reset`, { method: "POST" });
}

export function totals(stats: UpstreamStats) {
  let connections = 0;
  let requests = 0;
  for (const value of Object.values(stats)) {
    connections += value.connections;
    requests += value.requests;
  }
  return { connections, requests };
}
