#!/usr/bin/env bun
/**
 * Seed Admin Script
 *
 * Creates or updates the admin user using better-auth's signUpEmail API.
 * This script can run standalone (doesn't need server running).
 *
 * Required environment variables:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - ADMIN_EMAIL: The admin user's email
 *   - ADMIN_PASSWORD: The admin user's password
 *   - BETTER_AUTH_SECRET: Required by better-auth
 *   - BASE_DOMAIN: Required by auth config
 */

import "dotenv/config";
import { auth } from "@gitterm/auth";
import { db, eq } from "@gitterm/db";
import * as schema from "@gitterm/db/schema/auth";

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.log("[seed-admin] ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seeding");
  process.exit(0);
}

async function seedAdmin(): Promise<void> {
  console.log("[seed-admin] Seeding admin user...");
  console.log(`[seed-admin] Admin email: ${adminEmail}`);

  try {
    // Check if user already exists
    const existingUser = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, adminEmail as string))
      .limit(1);

    if (existingUser.length > 0) {
      const user = existingUser[0]!;

      // Ensure user has admin role
      if ((user as any).role !== "admin") {
        await db
          .update(schema.user)
          .set({
            role: "admin" as const,
            updatedAt: new Date(),
          })
          .where(eq(schema.user.id, user.id));

        console.log(`[seed-admin] Upgraded existing user to admin: ${adminEmail} (${user.id})`);
      } else {
        console.log(`[seed-admin] Admin user already exists: ${adminEmail} (${user.id})`);
      }
      return;
    }

    // Create new admin user using better-auth's email/password signup
    // This ensures password is properly hashed
    const result = await auth.api.signUpEmail({
      body: {
        email: adminEmail as string,
        password: adminPassword as string,
        name: "Admin",
      },
    });

    if (!result.user) {
      throw new Error("Failed to create admin user - no user returned");
    }

    // Update the user to have admin role and verified email
    await db
      .update(schema.user)
      .set({
        role: "admin" as const,
        emailVerified: true,
        plan: "pro" as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, result.user.id));

    console.log(`[seed-admin] Created admin user: ${adminEmail} (${result.user.id})`);
    console.log("[seed-admin] Admin seeding completed");
  } catch (error) {
    console.error("[seed-admin] Failed to seed admin:", error);
    process.exit(1);
  }
}

await seedAdmin();
process.exit(0);
