import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load from server .env in development only if file exists and DATABASE_URL is not already set
if (!process.env.SQLITE_DATABASE_URL) {
  const envPath = "../../apps/server/.env.development.local";
  // const envPath = "../../apps/server/.env";
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

if (!process.env.SQLITE_DATABASE_URL) {
  throw new Error("SQLITE_DATABASE_URL environment variable is required");
}

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_DATABASE_URL,
  },
});
