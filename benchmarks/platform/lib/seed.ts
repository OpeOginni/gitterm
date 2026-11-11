import { SQL } from "bun";
import { DATABASE_URL, PORTS } from "./config";

export type SeedOptions = {
  /** Filler workspaces: a realistic table size around the ones the benches hit. */
  workspaces: number;
  /** Running workspaces of each scenario kind, owned by the bench user. */
  scenario: number;
  upstreams: number;
  tlsUpstreams: number;
  userId: string;
};

const pad = (prefix: string, index: number) => `${prefix}${String(index).padStart(5, "0")}`;

/**
 * Fills the bench database: `workspaces` filler rows spread over 2000 users
 * (2% running, 28% paused, 70% terminated) plus four kinds of running workspace
 * for the bench user. Subdomains never contain "-": the resolver reads "<port>-" from it.
 */
export async function seed(options: SeedOptions) {
  const sql = new SQL(DATABASE_URL);
  try {
    const [{ id: imageId }] = await sql`
      select i.id from image i join agent_type a on a.id = i.agent_type_id
      where a.provisioner_key = 'opencode' order by i.name limit 1`;
    const [{ id: providerId }] =
      await sql`select id from cloud_provider where provider_key = 'e2b' limit 1`;

    await sql`delete from workspace`;
    await sql`delete from "user" where id like 'filler-%'`;

    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      select 'filler-' || g, 'Filler ' || g, 'filler' || g || '@gitterm.test', true, now(), now()
      from generate_series(1, 2000) g`;

    // Sessions for the filler users, so the session table is not a single row either.
    await sql`delete from session where user_id like 'filler-%'`;
    await sql`
      insert into session (id, expires_at, token, created_at, updated_at, user_id)
      select 'filler-session-' || g, now() + interval '7 days', md5('filler-token-' || g), now(), now(),
             'filler-' || (1 + g % 2000)
      from generate_series(1, 20000) g`;

    await sql`
      insert into workspace
        (external_instance_id, user_id, image_id, cloud_provider_id, domain, subdomain, upstream_url,
         status, started_at, updated_at, last_active_at)
      select
        'filler-' || g,
        'filler-' || (1 + g % 2000),
        ${imageId}::uuid,
        ${providerId}::uuid,
        substr(md5(g::text), 1, 8) || '.gitterm.test',
        substr(md5(g::text), 1, 8),
        'https://4096-' || substr(md5(g::text), 1, 20) || '.sandbox.invalid',
        (case when g % 100 < 2 then 'running' when g % 100 < 30 then 'paused' else 'terminated' end)::workspace_status,
        now() - (g % 1000) * interval '1 hour',
        now() - (g % 500) * interval '1 hour',
        now() - (g % 500) * interval '1 hour'
      from generate_series(1, ${options.workspaces}) g`;

    const kinds = {
      private: [] as string[],
      privateTls: [] as string[],
      serverOnly: [] as string[],
      publicPort: [] as string[],
    };
    const rows: Record<string, unknown>[] = [];
    const now = new Date();
    for (let index = 0; index < options.scenario; index += 1) {
      const http = `http://127.0.0.1:${PORTS.upstream + (index % options.upstreams)}`;
      const base = {
        user_id: options.userId,
        image_id: imageId,
        cloud_provider_id: providerId,
        status: "running",
        started_at: now,
        updated_at: now,
        server_only: false,
        exposed_ports: null as unknown,
      };
      const add = (list: string[], prefix: string, extra: Record<string, unknown>) => {
        const subdomain = pad(prefix, index);
        list.push(subdomain);
        rows.push({
          ...base,
          external_instance_id: `bench-${subdomain}`,
          domain: `${subdomain}.gitterm.test`,
          subdomain,
          upstream_url: http,
          ...extra,
        });
      };
      add(kinds.private, "p", {});
      add(kinds.serverOnly, "s", { server_only: true });
      add(kinds.publicPort, "u", {
        exposed_ports: { "3000": { port: 3000, upstreamUrl: http, visibility: "public" } },
      });
      if (options.tlsUpstreams > 0) {
        add(kinds.privateTls, "t", {
          upstream_url: `https://127.0.0.1:${PORTS.upstreamTls + (index % options.tlsUpstreams)}`,
        });
      }
    }
    for (let start = 0; start < rows.length; start += 500) {
      await sql`insert into workspace ${sql(rows.slice(start, start + 500))}`;
    }

    // Dependent tables at the size a deployment with this many workspaces would have:
    // access headers for workspaces that still exist, three usage sessions and two runs each.
    await sql`
      insert into workspace_route_access (workspace_id, encrypted_headers)
      select id, repeat('x', 300) from workspace
      where external_instance_id like 'filler-%' and status <> 'terminated'`;
    await sql`
      insert into usage_session (workspace_id, user_id, started_at, stopped_at, duration_minutes, stop_source)
      select w.id, w.user_id, w.started_at + n * interval '1 day',
             case when n = 3 and w.status = 'running' then null else w.started_at + n * interval '1 day' + interval '40 minutes' end,
             case when n = 3 and w.status = 'running' then null else 40 end,
             case when n = 3 and w.status = 'running' then null else 'idle'::session_stop_source end
      from workspace w cross join generate_series(1, 3) n
      where w.external_instance_id like 'filler-%'`;
    await sql`
      insert into agent_run (workspace_id, idempotency_key, request_hash, native_session_id, native_message_id,
                             status, title, submitted_at, completed_at)
      select w.id, 'run-' || n, md5(w.id::text || n), 'ses_' || md5(w.id::text), 'msg_' || md5(w.id::text || n),
             'completed'::agent_run_status,
             'Agent run', w.started_at, w.started_at + interval '5 minutes'
      from workspace w cross join generate_series(1, 2) n
      where w.external_instance_id like 'filler-%'`;

    await sql`analyze`;
    return kinds;
  } finally {
    await sql.close();
  }
}
