export const RedisKeys = {
  rateLimit: (userId: string) => `ratelimit:${userId}`,

  // Device code flow keys
  deviceCode: (deviceCode: string) => `device:code:${deviceCode}`,
  userCode: (userCode: string) => `device:user_code:${userCode}`,
} as const;
