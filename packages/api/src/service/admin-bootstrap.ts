/**
 * Admin Bootstrap Service
 * 
 * Creates an admin user from environment variables on first startup.
 * This is primarily for self-hosted deployments where users need
 * a way to access the admin panel without manual database seeding.
 * 
 * Key behavior:
 * - On startup, checks ADMIN_EMAIL env var
 * - If the env email differs from the stored bootstrap email, the old admin
 *   is demoted and the new one is promoted
 * - This keeps the env as the source of truth for the bootstrap admin
 */

import { db, eq } from "@gitterm/db";
import * as schema from "@gitterm/db/schema/auth";
import { getAdminCredentials, hasAdminBootstrap, isEmailAuthEnabled, isGitHubAuthEnabled } from "@gitterm/env/server";
import { auth } from "@gitterm/auth";

const BOOTSTRAP_ADMIN_KEY = "bootstrap_admin_email";

let bootstrapComplete = false;

/**
 * Get the currently stored bootstrap admin email from the database
 */
async function getStoredBootstrapEmail(): Promise<string | null> {
  const [config] = await db
    .select()
    .from(schema.systemConfig)
    .where(eq(schema.systemConfig.key, BOOTSTRAP_ADMIN_KEY))
    .limit(1);
  
  return config?.value ?? null;
}

/**
 * Store the bootstrap admin email in the database
 */
async function setStoredBootstrapEmail(email: string): Promise<void> {
  await db
    .insert(schema.systemConfig)
    .values({
      key: BOOTSTRAP_ADMIN_KEY,
      value: email,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.systemConfig.key,
      set: {
        value: email,
        updatedAt: new Date(),
      },
    });
}

/**
 * Clear the stored bootstrap admin email (when env is removed)
 */
async function clearStoredBootstrapEmail(): Promise<void> {
  await db
    .delete(schema.systemConfig)
    .where(eq(schema.systemConfig.key, BOOTSTRAP_ADMIN_KEY));
}

/**
 * Demote a user from admin to regular user
 */
async function demoteUser(email: string): Promise<void> {
  await db
    .update(schema.user)
    .set({
      role: "user" as const,
      updatedAt: new Date(),
    })
    .where(eq(schema.user.email, email));
  
  console.log(`[admin-bootstrap] Demoted previous bootstrap admin: ${email}`);
}

/**
 * Bootstrap admin user from environment variables
 * 
 * This function handles:
 * 1. First-time setup: Creates admin from ADMIN_EMAIL/ADMIN_PASSWORD
 * 2. Email change: Demotes old admin, promotes/creates new admin
 * 3. Env removed: Demotes the bootstrap admin (but leaves other admins)
 * 
 * Should be called once on server startup.
 */
export async function bootstrapAdmin(): Promise<{ created: boolean; email?: string; changed?: boolean }> {
  // Only run once per process
  if (bootstrapComplete) {
    return { created: false };
  }

  try {
    const storedEmail = await getStoredBootstrapEmail();
    const credentials = getAdminCredentials();
    const envEmail = credentials?.email;

    // Case 1: No env configured anymore, but we have a stored bootstrap admin
    if (!hasAdminBootstrap() && storedEmail) {
      console.log("[admin-bootstrap] ADMIN_EMAIL removed from env, demoting previous bootstrap admin");
      await demoteUser(storedEmail);
      await clearStoredBootstrapEmail();
      bootstrapComplete = true;
      return { created: false };
    }

    // Case 2: No env configured and no stored admin
    if (!hasAdminBootstrap()) {
      // Log specific reason for skipping
      if (isGitHubAuthEnabled()) {
        console.log("[admin-bootstrap] GitHub auth enabled, skipping email-based admin bootstrap");
      } else if (!isEmailAuthEnabled()) {
        console.log("[admin-bootstrap] Email auth disabled, skipping admin bootstrap");
      } else {
        console.log("[admin-bootstrap] No ADMIN_EMAIL/ADMIN_PASSWORD configured, skipping bootstrap");
      }
      bootstrapComplete = true;
      return { created: false };
    }

    if (!credentials || !envEmail) {
      bootstrapComplete = true;
      return { created: false };
    }

    const { email, password } = credentials;

    // Case 3: Env email differs from stored email - admin changed
    if (storedEmail && storedEmail !== email) {
      console.log(`[admin-bootstrap] Bootstrap admin changed from ${storedEmail} to ${email}`);
      await demoteUser(storedEmail);
    }

    // Check if new admin user already exists
    const existingUser = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      const user = existingUser[0]!;
      
      // Ensure user has admin role
      if ((user as any).role !== "admin") {
        await db
          .update(schema.user)
          .set({ 
            role: "admin" as const,
            updatedAt: new Date() 
          })
          .where(eq(schema.user.id, user.id));
        
        console.log(`[admin-bootstrap] Upgraded existing user ${email} to admin role`);
      } else {
        console.log(`[admin-bootstrap] Admin user ${email} already exists`);
      }
      
      // Update stored bootstrap email
      await setStoredBootstrapEmail(email);
      bootstrapComplete = true;
      return { created: false, email, changed: storedEmail !== email };
    }

    // Create new admin user using better-auth's email/password signup
    // This ensures password is properly hashed
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: "Admin",
      },
    });

    if (!result.user) {
      throw new Error("Failed to create admin user");
    }

    // Update the user to have admin role
    await db
      .update(schema.user)
      .set({ 
        role: "admin" as const,
        emailVerified: true, // Auto-verify admin
        updatedAt: new Date() 
      })
      .where(eq(schema.user.id, result.user.id));

    // Store the bootstrap email
    await setStoredBootstrapEmail(email);

    console.log(`[admin-bootstrap] Created admin user: ${email}`);
    bootstrapComplete = true;
    
    return { created: true, email };
  } catch (error) {
    console.error("[admin-bootstrap] Failed to bootstrap admin user:", error);
    throw error;
  }
}

/**
 * Check if bootstrap has been completed
 */
export function isBootstrapComplete(): boolean {
  return bootstrapComplete;
}

/**
 * Reset bootstrap state (for testing)
 */
export function resetBootstrapState(): void {
  bootstrapComplete = false;
}
