import { z } from "zod";

/**
 * Heartbeat request schema - sent by workspace agents
 */
export const heartbeatRequestSchema = z.object({
  workspaceId: z.string(),
  timestamp: z.number().optional(), // Unix timestamp in ms
  cpu: z.number().min(0).max(100).optional(), // CPU usage percentage
  memory: z.number().min(0).max(100).optional(), // Memory usage percentage
  active: z.boolean().optional(), // Is user actively using the workspace
});

export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

/**
 * Heartbeat response schema - sent back to workspace agents
 */
export const heartbeatResponseSchema = z.object({
  success: z.boolean(),
  action: z.enum(["continue", "shutdown"]),
  reason: z.string().nullable(),
});

export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

/**
 * Heartbeat action type for agents to handle
 */
export type HeartbeatAction = "continue" | "shutdown";

/**
 * Configuration for heartbeat behavior
 */
export const HEARTBEAT_CONFIG = {
  /** Interval between heartbeats in milliseconds */
  INTERVAL_MS: 30_000, // 30 seconds

  /** Timeout before workspace is considered idle (in minutes) */
  IDLE_TIMEOUT_MINUTES: 5,

  /** Maximum retries before giving up on heartbeat */
  MAX_RETRIES: 3,

  /** Delay between retries in milliseconds */
  RETRY_DELAY_MS: 5_000, // 5 seconds
} as const;
