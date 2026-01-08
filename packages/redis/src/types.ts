export interface TunnelConnectionInfo {
  workspaceId: string;
  userId: string;
  subdomain: string;
  primaryPort: number;
  exposedPorts?: Record<string, number>;
  connectedAt: number;
  lastPingAt: number;
  instanceId: string;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}
