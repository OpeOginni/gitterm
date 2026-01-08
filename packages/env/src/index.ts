/**
 * @gitterm/env - Type-safe environment variables with Zod
 *
 * Usage:
 *   import env from '@gitterm/env/server';
 *   console.log(env.DATABASE_URL); // Type-safe!
 */

import { z } from "zod";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse environment variables and throw on failure
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);

  if (!result.success) {
    console.error(result.error.issues);
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
}

// ============================================================================
// Schema Primitives
// ============================================================================

/** Boolean from string "true"/"false" */
export const boolStr = z
  .string()
  .optional()
  .transform((val) => val === "true");

/** Boolean with default value */
export const boolWithDefault = (defaultVal: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => (val === undefined ? defaultVal : val === "true"));

/** Port number */
export const port = z
  .string()
  .default("3000")
  .transform((val) => parseInt(val, 10));

/** Required non-empty string */
export const required = z.string().min(1);

/** Optional string */
export const optional = z.string().optional();

// ============================================================================
// Domain Schemas
// ============================================================================

export const deploymentMode = z.enum(["self-hosted", "managed"]).default("self-hosted");
export type DeploymentMode = z.infer<typeof deploymentMode>;

export const polarEnvironment = z.enum(["sandbox", "production"]).default("sandbox");
export type PolarEnvironment = z.infer<typeof polarEnvironment>;

export const routingMode = z.enum(["path", "subdomain"]).default("path");
export type RoutingMode = z.infer<typeof routingMode>;

export const computeProvider = z.enum(["railway", "local", "docker", "kubernetes"]);
export type ComputeProvider = z.infer<typeof computeProvider>;

export const nodeEnv = z.enum(["development", "production", "test"]).default("development");
export type NodeEnv = z.infer<typeof nodeEnv>;

/** Comma-separated list of providers */
export const providersList = z
  .string()
  .default("local")
  .transform((val) => val.split(",").map((p) => p.trim()));

// ============================================================================
// Exports
// ============================================================================

export { z };
