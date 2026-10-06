import { db, sql } from "@gitterm/db";
import { syncSubjects } from "./subjects";

/**
 * Copy usage sessions into `billing_usage_interval`, snapshotting what is
 * needed to price and explain them later: provider, region, machine spec,
 * always-on, bot, and the retail rate in effect when the
 * session started (effective-dated and append-only, so this matches what
 * billing charges).
 *
 * Idempotent: an interval is inserted once and later only gains its stop
 * time. Snapshots taken while a session is current are `observed`; rows
 * copied by a backfill are marked so their machine spec is `inferred`.
 */
export async function syncUsageIntervals(options: {
  /** Sessions started or stopped at/after this time, plus all open sessions. */
  since?: Date;
  /** Restrict to one user (e.g. right before their account is deleted). */
  userId?: string;
  /** Restrict by session start, for bounded backfills. */
  startedFrom?: Date;
  startedTo?: Date;
  provenance: "observed" | "reconstructed";
  limit?: number;
}): Promise<number> {
  await syncSubjects();
  const machineProvenance = options.provenance === "observed" ? "observed" : "inferred";
  // Timestamps are stored without a time zone as UTC; bind them rather than use now().
  const now = new Date().toISOString();
  const filters = [
    options.since
      ? sql`(s.stopped_at is null or s.stopped_at >= ${options.since.toISOString()}::timestamp or s.started_at >= ${options.since.toISOString()}::timestamp)`
      : sql`true`,
    options.userId ? sql`s.user_id = ${options.userId}` : sql`true`,
    options.startedFrom
      ? sql`s.started_at >= ${options.startedFrom.toISOString()}::timestamp`
      : sql`true`,
    options.startedTo
      ? sql`s.started_at < ${options.startedTo.toISOString()}::timestamp`
      : sql`true`,
  ];

  const result = await db.execute(sql`
    insert into billing_usage_interval (
      session_id, analytics_id, workspace_id, bot_id, workload, provider_key, cloud_provider_id,
      region, hosting_type, machine_profile_id, machine_key, machine_vcpus, machine_memory_gb,
      machine_provenance, always_on, started_at, stopped_at, stop_source,
      retail_micros_per_hour, status, provenance, first_recorded_at, updated_at
    )
    select
      s.id, subj.analytics_id, w.id, w.bot_id,
      case when w.bot_id is null then 'user' else 'bot' end,
      cp.provider_key, cp.id, r.external_region_identifier, w.hosting_type,
      mp.id, mp.key, mp.vcpus, mp.memory_gb, ${machineProvenance}, w.always_on,
      s.started_at, s.stopped_at, s.stop_source,
      retail.micros_per_hour,
      case when s.stopped_at is null then 'open' else 'closed' end,
      ${options.provenance}, ${now}::timestamp, ${now}::timestamp
    from usage_session s
    join workspace w on w.id = s.workspace_id
    join billing_analytics_subject subj on subj.user_id = s.user_id
    left join cloud_provider cp on cp.id = w.cloud_provider_id
    left join region r on r.id = w.region_id
    left join machine_profile mp on mp.id = w.machine_profile_id
    left join lateral (
      select rate.micros_per_hour from billing_machine_rate rate
      where rate.machine_profile_id = w.machine_profile_id and rate.effective_from <= s.started_at
      order by rate.effective_from desc limit 1
    ) retail on true
    where ${sql.join(filters, sql` and `)}
    order by s.started_at
    ${options.limit ? sql`limit ${options.limit}` : sql``}
    on conflict (session_id) do update set
      stopped_at = excluded.stopped_at,
      stop_source = excluded.stop_source,
      status = excluded.status,
      updated_at = excluded.updated_at
    where billing_usage_interval.stopped_at is distinct from excluded.stopped_at
  `);
  return result.rowCount ?? 0;
}
