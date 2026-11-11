#!/usr/bin/env bun
/**
 * Hot queries against the seeded bench database, as they are today and with a
 * candidate index. Each candidate is created inside a transaction that is rolled
 * back, so the database is left exactly as the migrations made it.
 *
 *   bun benchmarks/platform/bench-db.ts [--name db]
 *
 * Prints table sizes, then for each query: plan node, execution time and buffers
 * touched, before and after. Timings are the median of 15 executions.
 */
import { loadState, saveResult } from "./lib/config";
import { closeProbes, db } from "./lib/probes";

type Case = {
  name: string;
  /** How often production runs it. */
  frequency: string;
  /** Where the query comes from. */
  source: string;
  sql: string;
  params: unknown[];
  /** Candidate index statements; omitted when the existing indexes are expected to cover it. */
  index?: string[];
};

const state = loadState();
const sql = db();

const [{ id: workspaceId }] =
  await sql`select id from workspace where subdomain = ${state.subdomains.private[0]!}`;
const [{ user_id: fillerUser }] =
  await sql`select user_id from workspace where external_instance_id like 'filler-%' limit 1`;
const [{ id: fillerWorkspace }] =
  await sql`select id from workspace where external_instance_id like 'filler-%' and status = 'running' limit 1`;

const RESOLVE = `
  select w.id, w.subdomain, w.user_id, w.upstream_url, w.hosting_type, w.status, w.server_only,
         a.name, a.provisioner_key, w.exposed_ports
  from workspace w
  join image i on w.image_id = i.id
  join agent_type a on i.agent_type_id = a.id
  where w.subdomain = $1 and w.status = 'running'
  limit 1`;
const SUBDOMAIN = [`create index bench_workspace_subdomain on workspace (subdomain)`];

const cases: Case[] = [
  {
    name: "proxy resolve: running workspace by subdomain (hit)",
    frequency: "each proxied request whose 15 s cache entry expired",
    source: "packages/api/src/routers/proxy/index.ts",
    sql: RESOLVE,
    params: [state.subdomains.private.at(-1)],
    index: SUBDOMAIN,
  },
  {
    name: "proxy resolve: unknown subdomain (miss)",
    frequency: "each request for a subdomain not seen in the last 60 s",
    source: "packages/api/src/routers/proxy/index.ts",
    sql: RESOLVE,
    params: ["nosuchws"],
    index: SUBDOMAIN,
  },
  {
    name: "create: is this subdomain taken?",
    frequency: "each workspace create, per attempt",
    source: "packages/api/src/routers/workspace/managment.ts",
    sql: `select id from workspace where subdomain = $1 limit 1`,
    params: ["nosuchws"],
    index: SUBDOMAIN,
  },
  {
    name: "route access headers for a workspace",
    frequency: "each proxied request whose 15 s cache entry expired",
    source: "packages/api/src/service/workspace-route-access.ts",
    sql: `select encrypted_headers from workspace_route_access where workspace_id = $1 and port is null limit 1`,
    params: [workspaceId],
    index: [
      `create index bench_route_access_workspace on workspace_route_access (workspace_id, port)`,
    ],
  },
  {
    name: "all running workspaces",
    frequency: "three times per idle reaper pass",
    source: "packages/api/src/routers/internal/index.ts",
    sql: `select id, user_id, last_active_at from workspace where status = 'running'`,
    params: [],
    index: [
      `create index bench_workspace_live_status on workspace (status) where status <> 'terminated'`,
    ],
  },
  {
    name: "workspace by provider instance id",
    frequency: "each provider webhook and compute job event",
    source: "packages/api/src/routers/internal/index.ts, service/compute-events.ts",
    sql: `select id, user_id from workspace where external_instance_id = $1`,
    params: ["filler-4242"],
    index: [`create index bench_workspace_external_instance on workspace (external_instance_id)`],
  },
  {
    name: "open usage sessions of a workspace",
    frequency: "twice per pause, terminate and provider webhook",
    source: "packages/api/src/utils/metering.ts",
    sql: `select id from usage_session where workspace_id = $1 and stopped_at is null`,
    params: [fillerWorkspace],
    index: [`create index bench_usage_session_workspace on usage_session (workspace_id)`],
  },
  {
    name: "usage sessions of a user",
    frequency: "each create and restart (run allowance), billing page, reaper pass",
    source: "packages/billing/src/usage.ts",
    sql: `select s.id, s.started_at, s.stopped_at from usage_session s join workspace w on w.id = s.workspace_id
          where s.user_id = $1 and s.started_at < now()`,
    params: [fillerUser],
    index: [`create index bench_usage_session_user on usage_session (user_id, stopped_at)`],
  },
  {
    name: "active agent runs (watcher sweep; none active in the seed)",
    frequency: "every 30 s on every API replica",
    source: "packages/api/src/service/agent-run/watcher.ts",
    sql: `select id, workspace_id, native_session_id, native_message_id, submitted_at, deadline_at, status, pending_inputs
          from agent_run where status in ('running', 'retrying', 'awaiting_input')`,
    params: [],
    index: [
      `create index bench_agent_run_active on agent_run (status) where status in ('pending', 'running', 'retrying', 'awaiting_input')`,
    ],
  },
  {
    name: "session by token (better-auth getSession)",
    frequency: "each request on a private route",
    source: "packages/auth/src/index.ts",
    sql: `select * from session where token = $1`,
    params: [state.cookie.split("=")[1]!.split(".")[0]],
  },
  {
    name: "sessions of a user (better-auth list / revoke)",
    frequency: "sign-out everywhere, account deletion",
    source: "better-auth",
    sql: `select * from session where user_id = $1`,
    params: [fillerUser],
    index: [`create index bench_session_user on session (user_id)`],
  },
];

type Measured = { node: string; ms: number; buffers: number };

async function measure(tx: typeof sql, text: string, params: unknown[]): Promise<Measured> {
  const times: number[] = [];
  let node = "";
  let buffers = 0;
  for (let run = 0; run < 15; run += 1) {
    const [row] = await tx.unsafe(
      `explain (analyze, buffers, format json) ${text}`,
      params as never[],
    );
    const plan = (row as { "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }> })[
      "QUERY PLAN"
    ][0]!;
    times.push(plan["Execution Time"]);
    node = scanNodes(plan.Plan).join(" + ");
    buffers = (plan.Plan["Shared Hit Blocks"] ?? 0) + (plan.Plan["Shared Read Blocks"] ?? 0);
  }
  times.sort((a, b) => a - b);
  return { node, ms: Math.round(times[7]! * 1000) / 1000, buffers };
}

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
};

/** The scan nodes of a plan, e.g. "Seq Scan workspace". */
function scanNodes(plan: PlanNode): string[] {
  const own = plan["Node Type"].includes("Scan")
    ? [`${plan["Node Type"]} ${plan["Index Name"] ?? plan["Relation Name"] ?? ""}`.trim()]
    : [];
  return [...own, ...(plan.Plans ?? []).flatMap(scanNodes)];
}

const sizes = await sql`
  select relname as table, n_live_tup::int as rows, pg_size_pretty(pg_total_relation_size(relid)) as size
  from pg_stat_user_tables
  where relname in ('workspace', 'workspace_route_access', 'usage_session', 'agent_run', 'session', 'user')
  order by n_live_tup desc`;
console.log("tables:");
for (const row of sizes)
  console.log(
    `  ${String(row.table).padEnd(24)} ${String(row.rows).padStart(8)} rows  ${row.size}`,
  );

/** Omitted from the comparison baseline only; each transaction is rolled back. */
const SHIPPED = [
  "workspace_subdomain_idx",
  "workspace_external_instance_idx",
  "workspace_live_status_idx",
  "usage_session_workspace_idx",
  "usage_session_user_stopped_idx",
  "workspace_route_access_workspace_port_idx",
  "agent_run_active_idx",
  "session_user_id_idx",
];
const ANALYZE = "analyze workspace, workspace_route_access, usage_session, agent_run, session";

const results: unknown[] = [];
for (const item of cases) {
  let before: Measured = { node: "", ms: 0, buffers: 0 };
  let after: Measured | null = null;
  await sql
    .begin(async (tx) => {
      const inTx = tx as unknown as typeof sql;
      await tx.unsafe(`drop index if exists ${SHIPPED.join(", ")}`);
      await tx.unsafe(ANALYZE);
      before = await measure(inTx, item.sql, item.params);
      if (item.index) {
        for (const statement of item.index) await tx.unsafe(statement);
        await tx.unsafe(ANALYZE);
        after = await measure(inTx, item.sql, item.params);
      }
      throw new Error("rollback");
    })
    .catch((error: Error) => {
      if (error.message !== "rollback") throw error;
    });
  results.push({ ...item, before, after });
  console.log(`\n${item.name}\n  runs: ${item.frequency}`);
  console.log(
    `  baseline ${String(before.ms).padStart(8)} ms  ${String(before.buffers).padStart(6)} buffers  ${before.node}`,
  );
  if (after) {
    const a = after as Measured;
    console.log(
      `  index  ${String(a.ms).padStart(8)} ms  ${String(a.buffers).padStart(6)} buffers  ${a.node}`,
    );
    console.log(`  ${item.index!.join("; ")}`);
  }
}

console.log(
  `\nsaved ${saveResult(process.argv.includes("--name") ? process.argv[process.argv.indexOf("--name") + 1]! : "db", { sizes, results })}`,
);
await closeProbes();
