#!/usr/bin/env bun
/**
 * CLI entry point for applying committed SQL migrations.
 *
 * Usage:
 *   bun run db:migrate:dev   # apps/server/.env.development.local (local docker postgres)
 *   bun run db:migrate:prod  # DATABASE_URL env, or apps/server/.env
 *
 * Uses drizzle-orm's programmatic migrator rather than drizzle-kit so it can
 * run in the slim production image. It records progress in the same
 * `drizzle.__drizzle_migrations` table drizzle-kit uses, so databases that
 * were migrated with `drizzle-kit migrate` continue from where they left off.
 *
 * Waits for the database to accept connections and holds an advisory lock for
 * the duration, so multiple replicas booting together do not race.
 *
 * The SQL folder defaults to ./migrations next to this file; when bundled into
 * another location (the server image), point DB_MIGRATIONS_DIR at it instead.
 */
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  createBootstrapPool,
  loadDatabaseUrl,
  waitForDatabase,
  withBootstrapLock,
} from "./bootstrap";

const SCRIPT = "migrate";
const { url } = loadDatabaseUrl(SCRIPT);
const migrationsFolder = process.env.DB_MIGRATIONS_DIR
  ? resolve(process.env.DB_MIGRATIONS_DIR)
  : resolve(import.meta.dir, "./migrations");

const pool = createBootstrapPool(url);

try {
  await waitForDatabase(pool, SCRIPT);
  await withBootstrapLock(pool, SCRIPT, async () => {
    console.log(`[${SCRIPT}] Applying migrations from ${migrationsFolder}`);
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(`[${SCRIPT}] Migrations up to date`);
  });
} catch (error) {
  console.error(`[${SCRIPT}] Error:`, error);
  await pool.end().catch(() => {});
  process.exit(1);
}

await pool.end();
process.exit(0);
