export const RedisKeys = {
  tunnelConnection: (subdomain: string) => `tunnel:connection:${subdomain}`,
  tunnelServicePort: (fullSubdomain: string) => `tunnel:service:${fullSubdomain}:port`,
  tunnelServiceBase: (fullSubdomain: string) => `tunnel:service:${fullSubdomain}:base`,
  userTunnels: (userId: string) => `user:tunnels:${userId}`,
  rateLimit: (userId: string) => `ratelimit:${userId}`,

  // Device code flow keys
  deviceCode: (deviceCode: string) => `device:code:${deviceCode}`,
  userCode: (userCode: string) => `device:user_code:${userCode}`,
} as const;

export const RedisChannels = {
  tunnelConnected: "tunnel:connected",
  tunnelDisconnected: "tunnel:disconnected",
  tunnelRevoke: "tunnel:revoke",
} as const;
