/**
 * Agent Loop Configuration Constants
 *
 * These values are used across the agent loop system:
 * - Sandbox sleepAfter timeout (in agent-worker/src/index.ts - must be updated manually there)
 * - UI to determine if a run is stuck/dead
 * - Any timeout-related logic
 *
 * NOTE: The Cloudflare agent-worker cannot import this file directly.
 * If you change AGENT_LOOP_RUN_TIMEOUT_MINUTES, also update the sleepAfter
 * value in packages/api/src/providers/cloudflare/agent-worker/src/index.ts
 */

/**
 * Maximum time (in minutes) a run can be active before being considered dead/stuck.
 * Used for:
 * - Sandbox sleepAfter configuration
 * - UI restart button visibility
 */
export const AGENT_LOOP_RUN_TIMEOUT_MINUTES = 40;

/**
 * Maximum time (in milliseconds) a run can be active before being considered dead/stuck.
 */
export const AGENT_LOOP_RUN_TIMEOUT_MS = AGENT_LOOP_RUN_TIMEOUT_MINUTES * 60 * 1000;

/**
 * Sandbox sleepAfter value (formatted for Cloudflare sandbox API)
 */
export const AGENT_LOOP_SANDBOX_SLEEP_AFTER = `${AGENT_LOOP_RUN_TIMEOUT_MINUTES}m`;
