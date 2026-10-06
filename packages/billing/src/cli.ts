#!/usr/bin/env bun
/**
 * Billing analytics maintenance. Managed deployments only.
 *
 *   bun run billing:analytics backfill [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--batch-days 7] [--polar] [--dry-run]
 *   bun run billing:analytics rebuild --from YYYY-MM-DD
 *   bun run billing:analytics import-costs --file costs.json [--dry-run]
 *
 * Every command except a dry run requires --confirm-database <host>/<database>
 * matching DATABASE_URL, so it can't run against the wrong database by
 * accident. All writes are idempotent: rerunning a command (for example after
 * an interruption, from the last reported watermark) is safe.
 */
import { readFile } from "node:fs/promises";
import { db, sql } from "@gitterm/db";
import { recordAccountSnapshot } from "./accounts";
import { rebuildAccountPeriods } from "./analytics/account-periods";
import { recordOrder, recordRefund } from "./analytics/payments";
import { importProviderCosts, providerCostImportSchema } from "./analytics/provider-costs";
import { syncSubjects } from "./analytics/subjects";
import { syncUsageIntervals } from "./analytics/usage-intervals";
import { listAllOrders, listAllRefunds } from "./polar";

const DAY_MS = 86_400_000;

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}"`);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      index++;
    } else {
      flags.set(arg.slice(2), true);
    }
  }
  return { command, flags };
}

const dateFlag = (flags: Map<string, string | true>, name: string, fallback?: Date) => {
  const value = flags.get(name);
  if (value === undefined) {
    if (fallback) return fallback;
    throw new Error(`--${name} YYYY-MM-DD is required`);
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--${name} must be YYYY-MM-DD`);
  }
  return new Date(`${value}T00:00:00.000Z`);
};

/** host/database of DATABASE_URL, for the explicit confirmation flag. */
function databaseTarget(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  return `${url.host}${url.pathname}`;
}

function requireConfirmation(flags: Map<string, string | true>, dryRun: boolean) {
  const target = databaseTarget();
  console.log(`[billing] database: ${target}${dryRun ? " (dry run: no writes)" : ""}`);
  if (dryRun) return;
  if (flags.get("confirm-database") !== target) {
    throw new Error(`Refusing to write: pass --confirm-database ${target} to confirm the target.`);
  }
}

async function backfill(flags: Map<string, string | true>, dryRun: boolean) {
  const to = dateFlag(flags, "to", new Date());
  const firstSession = await db.execute<{ first: string | null }>(
    sql`select min(started_at) as first from usage_session`,
  );
  const defaultFrom = firstSession.rows[0]?.first ? new Date(firstSession.rows[0].first) : to;
  const from = dateFlag(flags, "from", defaultFrom);
  const batchDays = Number(flags.get("batch-days") ?? 7);
  if (!Number.isInteger(batchDays) || batchDays < 1 || batchDays > 31) {
    throw new Error("--batch-days must be 1-31");
  }

  // 1. Analytics subjects for every real user.
  if (dryRun) {
    const missing = await db.execute<{ count: string }>(sql`
      select count(*) from "user" u
      where not exists (select 1 from billing_analytics_subject s where s.user_id = u.id)
        and u.email not like '%@anon.gitterm.local'`);
    console.log(`[backfill] subjects to create: ${missing.rows[0]?.count}`);
  } else {
    console.log(`[backfill] subjects created: ${await syncSubjects()}`);
  }

  // 2. Usage intervals, in session-start windows. Restart from the last watermark printed.
  for (let start = from; start < to; start = new Date(start.getTime() + batchDays * DAY_MS)) {
    const end = new Date(Math.min(start.getTime() + batchDays * DAY_MS, to.getTime()));
    if (dryRun) {
      const count = await db.execute<{ count: string }>(sql`
        select count(*) from usage_session
        where started_at >= ${start.toISOString()}::timestamp and started_at < ${end.toISOString()}::timestamp`);
      console.log(
        `[backfill] ${start.toISOString()} → ${end.toISOString()}: ${count.rows[0]?.count} sessions`,
      );
      continue;
    }
    const written = await syncUsageIntervals({
      startedFrom: start,
      startedTo: end,
      provenance: "reconstructed",
    });
    console.log(
      `[backfill] intervals through ${end.toISOString()}: ${written} written (watermark)`,
    );
  }

  // 3. A starting snapshot for accounts with no recorded history. The state is
  //    observed now; nothing earlier is invented.
  const accounts = (
    await db.execute<{ userId: string }>(sql`
      select a.user_id as "userId" from billing_account a
      left join billing_analytics_subject s on s.user_id = a.user_id
      where s.analytics_id is null
         or not exists (select 1 from billing_account_event e where e.analytics_id = s.analytics_id)`)
  ).rows;
  console.log(`[backfill] account snapshots to record: ${accounts.length}`);
  if (!dryRun) {
    for (const { userId } of accounts) {
      await recordAccountSnapshot(userId, { source: "backfill", actor: "system" });
    }
  }

  // 4. Optional: orders and refunds from Polar's API.
  if (flags.get("polar")) {
    let orders = 0;
    for await (const order of listAllOrders()) {
      orders++;
      if (!dryRun) await recordOrder(order, "api_backfill", order.customer.external_id ?? null);
    }
    let refunds = 0;
    for await (const refund of listAllRefunds()) {
      refunds++;
      if (!dryRun) await recordRefund(refund, "api_backfill", null);
    }
    console.log(`[backfill] Polar orders: ${orders}, refunds: ${refunds}`);
  }

  // 5. Summaries for the backfilled range.
  if (!dryRun) {
    const result = await rebuildAccountPeriods({ from });
    console.log(
      `[backfill] rebuilt ${result.periods} account-periods for ${result.subjects} accounts`,
    );
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const dryRun = flags.get("dry-run") === true;

  if (command === "backfill") {
    requireConfirmation(flags, dryRun);
    await backfill(flags, dryRun);
  } else if (command === "rebuild") {
    requireConfirmation(flags, false);
    const result = await rebuildAccountPeriods({ from: dateFlag(flags, "from") });
    console.log(
      `[rebuild] ${result.periods} account-periods for ${result.subjects} accounts, cutoff ${result.cutoff.toISOString()}`,
    );
  } else if (command === "import-costs") {
    const file = flags.get("file");
    if (typeof file !== "string") throw new Error("--file <path> is required");
    const parsed = providerCostImportSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) {
      console.error(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
      );
      process.exit(1);
    }
    requireConfirmation(flags, dryRun);
    const result = await importProviderCosts(parsed.data, { dryRun });
    console.log(
      `[import-costs] ${dryRun ? "would import" : "imported"} ${result.costs} costs and ${result.costRates} cost rates`,
    );
  } else {
    console.error("Usage: billing:analytics <backfill|rebuild|import-costs> [flags]");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`[billing] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
