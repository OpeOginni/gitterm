import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

/**
 * Run database migrations programmatically
 * This is used for Railway template deployments where migrations
 * need to run automatically on server startup.
 * 
 * @param databaseUrl - PostgreSQL connection string
 * @param migrationsPath - Optional custom path to migrations folder
 */
export async function runMigrations(
  databaseUrl: string,
  migrationsPath?: string
): Promise<{ success: boolean; error?: Error }> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1, // Single connection for migrations
  });

  try {
    const db = drizzle(pool);

    // Try multiple possible locations for migrations
    const possiblePaths = [
      migrationsPath,
      // Docker: migrations copied to /app/migrations
      "/app/migrations",
      // Development: relative to this file
      path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations"),
      // Fallback: current working directory
      path.join(process.cwd(), "migrations"),
    ].filter(Boolean) as string[];

    let folder: string | undefined;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        folder = p;
        break;
      }
    }

    if (!folder) {
      console.log("[migrate] No migrations folder found, skipping migrations");
      return { success: true };
    }

    console.log("[migrate] Running database migrations...");
    console.log(`[migrate] Migrations folder: ${folder}`);

    await migrate(db, { migrationsFolder: folder });

    console.log("[migrate] Migrations completed successfully");
    return { success: true };
  } catch (error) {
    console.error("[migrate] Migration failed:", error);
    return { success: false, error: error as Error };
  } finally {
    await pool.end();
  }
}

/**
 * Run migrations and exit (for CLI usage)
 */
export async function runMigrationsAndExit(databaseUrl: string): Promise<never> {
  const result = await runMigrations(databaseUrl);
  process.exit(result.success ? 0 : 1);
}
