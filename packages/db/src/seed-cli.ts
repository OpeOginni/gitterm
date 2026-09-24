#!/usr/bin/env bun
/**
 * CLI entry point for database seeding.
 *
 * Usage:
 *   bun run db:seed:dev   # apps/server/.env.development.local (local docker postgres)
 *   bun run db:seed:prod  # DATABASE_URL env, or apps/server/.env
 *
 * Docker/production: set DATABASE_URL in the environment and run db:seed:prod.
 * Existing DATABASE_URL is preferred for prod so container env wins.
 *
 * Holds the shared bootstrap advisory lock while seeding so concurrent
 * replicas don't insert duplicate seed rows.
 */
import {
  createBootstrapPool,
  loadDatabaseUrl,
  waitForDatabase,
  withBootstrapLock,
} from "./bootstrap";

const SCRIPT = "seed";
const { url } = loadDatabaseUrl(SCRIPT);

// `./index` reads DATABASE_URL at import time, so load it only after the env is resolved.
const { seedDatabase } = await import("./seed");

const pool = createBootstrapPool(url);

try {
  await waitForDatabase(pool, SCRIPT);
  await withBootstrapLock(pool, SCRIPT, () => seedDatabase());
  console.log(`[${SCRIPT}] Done`);
} catch (error) {
  console.error(`[${SCRIPT}] Error:`, error);
  await pool.end().catch(() => {});
  process.exit(1);
}

await pool.end();
process.exit(0);
