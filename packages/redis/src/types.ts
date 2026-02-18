export interface RateLimitConfig {
  requestsPerMinute: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}
