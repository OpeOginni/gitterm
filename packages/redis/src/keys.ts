export const RedisKeys = {
  rateLimit: (userId: string) => `ratelimit:${userId}`,

  // Device code flow keys
  deviceCode: (deviceCode: string) => `device:code:${deviceCode}`,
  userCode: (userCode: string) => `device:user_code:${userCode}`,

  // Proxy resolver cache keys
  proxyWorkspace: (subdomain: string) => `proxy:workspace:${subdomain}`,
  proxyWorkspaceMiss: (subdomain: string) => `proxy:workspace:miss:${subdomain}`,
  proxyRouteAccess: (workspaceId: string, port: number | null) =>
    `proxy:route_access:${workspaceId}:${port ?? "default"}`,

  // Workspace activity tracking
  workspaceLastActive: (workspaceId: string) => `workspace:last_active:${workspaceId}`,
  workspaceLastActivePersistThrottle: (workspaceId: string) =>
    `workspace:last_active:persist_throttle:${workspaceId}`,
} as const;
