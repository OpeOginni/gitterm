#!/usr/bin/env bun
/**
 * CLI entry point for database seeding
 * Run with: bun run packages/db/src/seed-cli.ts
 */

import "dotenv/config";
import { seedDatabase } from "./seed";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[seed] DATABASE_URL is required");
  process.exit(1);
}

seedDatabase()
  .then(() => {
    console.log("[seed] Done");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[seed] Error:", error);
    process.exit(1);
  });
