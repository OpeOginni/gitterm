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
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const isProd = process.argv.includes("--prod");
const target = isProd ? "prod" : "dev";
const envFile = isProd ? ".env" : ".env.development.local";
const envPath = resolve(import.meta.dir, "../../../apps/server", envFile);

if (isProd) {
  // Prefer runtime env (Docker/CI). Fall back to apps/server/.env for manual prod seeds.
  if (!process.env.DATABASE_URL && existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
} else {
  // Always bind dev seed to the local development env file when present.
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    `[seed] DATABASE_URL is required for ${target} seed. Expected it in ${envPath} or the environment.`,
  );
  process.exit(1);
}

const maskedUrl = databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
console.log(`[seed] target=${target}`);
console.log(`[seed] database=${maskedUrl}`);

const { seedDatabase } = await import("./seed");

try {
  await seedDatabase();
  console.log("[seed] Done");
  process.exit(0);
} catch (error) {
  console.error("[seed] Error:", error);
  process.exit(1);
}
