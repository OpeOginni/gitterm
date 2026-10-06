import {
  database,
  defineRailway,
  github,
  group,
  image,
  preserve,
  project,
  redis,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const gitterm = github("OpeOginni/gitterm", { checkSuites: false });

  const Postgres = database("Postgres", "postgres", {
    image: "ghcr.io/railwayapp-templates/postgres-ssl:17",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
    region: "us-east4-eqdc4a",
  });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  const Redis = redis("Redis", { region: "us-east4-eqdc4a" });
  Redis.deploy = {
    startCommand:
      '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
  };
  Redis.networking = { privateNetworkEndpoint: "redis", tcpProxies: { "6379": {} } };
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });
  const drizzleGatewayVolume = volume("drizzle-gateway-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });
  const redisVolume = volume("redis-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });

  const rootWatch = ["turbo.json", "package.json", "bun.lock"];

  const IdleInstanceReaper = service("Idle Instance Reaper", {
    source: gitterm,
    build: {
      builder: "RAILPACK",
      buildCommand: "turbo build --filter=worker",
      watchPatterns: [
        "apps/worker/**/*",
        "packages/api/**/*",
        "packages/config/**/*",
        "apps/worker/.env*",
        ...rootWatch,
      ],
    },
    deploy: {
      startCommand: "cd apps/worker && bun run dist/idle-reaper.mjs",
      cronSchedule: "*/10 * * * *",
      restartPolicyType: "NEVER",
    },
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "idle-instance-reaper" },
    env: {
      ENABLE_IDLE_REAPING: preserve(),
      ENABLE_QUOTA_ENFORCEMENT: preserve(),
      INTERNAL_API_KEY: preserve(),
      REAP_INTERVAL_MINUTES: preserve(),
      SERVER_URL: preserve(),
      WORKSPACE_JWT_SECRET: preserve(),
    },
  });
  const web = service("web", {
    source: gitterm,
    build: {
      builder: "RAILPACK",
      buildCommand: "turbo build --filter=web",
      watchPatterns: [
        "apps/web/**/*",
        "packages/api/**/*",
        "packages/auth/**/*",
        "packages/config/**/*",
        "packages/env/**/*",
        "apps/web/.env*",
        ...rootWatch,
      ],
    },
    deploy: {
      startCommand: "cd apps/web && npm run start",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 100,
      restartPolicyType: "NEVER",
    },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["gitterm.dev"],
    env: {
      NEXT_PUBLIC_AUTH_URL: preserve(),
      NEXT_PUBLIC_BASE_DOMAIN: preserve(),
      // This project hosts the managed product, not the email-only self-hosted image.
      NEXT_PUBLIC_DEPLOYMENT_MODE: "managed",
      NEXT_PUBLIC_ENABLE_ANON_TRY: preserve(),
      NEXT_PUBLIC_ENABLE_BILLING: preserve(),
      NEXT_PUBLIC_ENABLE_EMAIL_AUTH: preserve(),
      NEXT_PUBLIC_ENABLE_GITHUB_AUTH: preserve(),
      NEXT_PUBLIC_GITHUB_APP_NAME: preserve(),
      NEXT_PUBLIC_LISTENER_URL: preserve(),
      NEXT_PUBLIC_POSTHOG_HOST: preserve(),
      NEXT_PUBLIC_POSTHOG_KEY: preserve(),
      NEXT_PUBLIC_ROUTING_MODE: preserve(),
      NEXT_PUBLIC_SERVER_URL: preserve(),
      NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY: preserve(),
      NEXT_PUBLIC_WEB_URL: preserve(),
    },
  });
  const CaddyProxy = service("Caddy Proxy", {
    source: gitterm,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "./apps/proxy/Dockerfile.managed",
      watchPatterns: ["apps/proxy/**/*", ...rootWatch],
    },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: [{ domain: "*.gitterm.dev", port: 80 }],
    networking: { privateNetworkEndpoint: "nginx-proxy" },
    env: { INTERNAL_API_KEY: preserve(), SERVER_URL: preserve(), WORKSPACE_JWT_SECRET: preserve() },
  });
  const Server = service("Server", {
    source: gitterm,
    build: {
      builder: "RAILPACK",
      buildCommand: "turbo build --filter=server",
      watchPatterns: [
        "apps/server/**/*",
        "packages/agent-runtime/**/*",
        "packages/api/**/*",
        "packages/auth/**/*",
        "packages/config/**/*",
        "packages/db/**/*",
        "packages/env/**/*",
        "packages/schema/**/*",
        "apps/server/.env*",
        ...rootWatch,
      ],
    },
    deploy: {
      startCommand: "cd apps/server && bun run dist/src/index.mjs",
      healthcheckPath: "/",
      healthcheckTimeout: 100,
      restartPolicyType: "NEVER",
    },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["api.gitterm.dev"],
    networking: { privateNetworkEndpoint: "server" },
    env: {
      API_URL: preserve(),
      BASE_DOMAIN: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      CLI_JWT_SECRET: preserve(),
      CORS_ORIGIN: preserve(),
      DATABASE_URL: preserve(),
      DEPLOYMENT_MODE: preserve(),
      DEVICE_CODE_VERIFICATION_URI: preserve(),
      DISCORD_DM_CHANNEL_ID: preserve(),
      DISCORD_TOKEN: preserve(),
      ENABLE_ANON_TRY: preserve(),
      ENABLE_GITHUB_AUTH: preserve(),
      ENCRYPTION_MASTER_KEY: preserve(),
      ENCRYPTION_MASTER_KEY_ID: preserve(),
      GITHUB_APP_CLIENT_ID: preserve(),
      GITHUB_APP_CLIENT_SECRET: preserve(),
      GITHUB_APP_ID: preserve(),
      GITHUB_APP_PRIVATE_KEY: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      GITHUB_WEBHOOK_SECRET: preserve(),
      INTERNAL_API_KEY: preserve(),
      LISTENER_URL: preserve(),
      POLAR_ACCESS_TOKEN: preserve(),
      POLAR_ENVIRONMENT: preserve(),
      POLAR_GROWTH_PRODUCT_ID: preserve(),
      POLAR_PRO_PRODUCT_ID: preserve(),
      POLAR_STARTER_PRODUCT_ID: preserve(),
      POLAR_WEBHOOK_SECRET: preserve(),
      REDIS_URL: preserve(),
      ROUTING_MODE: preserve(),
      WORKLOAD_IDENTITY_ISSUER: preserve(),
      WORKLOAD_IDENTITY_KEY_ID: preserve(),
      WORKLOAD_IDENTITY_PRIVATE_KEY: preserve(),
      WORKSPACE_API_URL: preserve(),
      WORKSPACE_JWT_SECRET: preserve(),
    },
  });
  const AnonInstanceReaper = service("Anon Instance Reaper", {
    source: gitterm,
    build: {
      builder: "RAILPACK",
      buildCommand: "turbo build --filter=anon-reaper",
      watchPatterns: [
        "apps/anon-reaper/**/*",
        "packages/api/**/*",
        "packages/config/**/*",
        ...rootWatch,
      ],
    },
    deploy: {
      startCommand: "cd apps/anon-reaper && bun run dist/anon-reaper.mjs",
      cronSchedule: "*/5 * * * *",
      restartPolicyType: "NEVER",
    },
    replicas: { "europe-west4-drams3a": 1 },
    networking: { privateNetworkEndpoint: "anon-instance-reaper" },
    env: {
      ENABLE_IDLE_REAPING: preserve(),
      ENABLE_QUOTA_ENFORCEMENT: preserve(),
      INTERNAL_API_KEY: preserve(),
      SERVER_URL: preserve(),
      WORKSPACE_JWT_SECRET: preserve(),
    },
  });
  const DrizzleGateway = service("Drizzle Gateway", {
    source: image("ghcr.io/drizzle-team/gateway:latest"),
    healthcheck: "/health",
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "drizzle-gateway" },
    volumeMounts: { "/app": drizzleGatewayVolume },
    env: { MASTERPASS: preserve() },
  });
  const Listener = service("Listener", {
    source: gitterm,
    build: {
      builder: "RAILPACK",
      buildCommand: "turbo build --filter=listener",
      watchPatterns: [
        "apps/listener/**/*",
        "packages/api/**/*",
        "packages/auth/**/*",
        "packages/config/**/*",
        "packages/db/**/*",
        "packages/schema/**/*",
        "apps/listener/.env*",
        ...rootWatch,
      ],
    },
    deploy: {
      startCommand: "cd apps/listener && bun run dist/index.mjs",
      healthcheckPath: "/health",
      healthcheckTimeout: 100,
      restartPolicyType: "NEVER",
    },
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "gitterm" },
    env: {
      BASE_DOMAIN: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      DATABASE_URL: preserve(),
      DISCORD_DM_CHANNEL_ID: preserve(),
      DISCORD_TOKEN: preserve(),
      GITHUB_WEBHOOK_SECRET: preserve(),
      INTERNAL_API_KEY: preserve(),
      PORT: preserve(),
      RAILWAY_PROJECT_ID: preserve(),
      REDIS_URL: preserve(),
      SERVER_URL: preserve(),
      WORKSPACE_JWT_SECRET: preserve(),
    },
  });
  const Workers = group("Workers", [IdleInstanceReaper]);
  const Frontends = group("Frontends", [web, CaddyProxy]);
  const resource = group("Database", [Postgres, Redis, DrizzleGateway]);

  return project("Gitterm", {
    resources: [
      Server,
      AnonInstanceReaper,
      Listener,
      postgresVolume,
      drizzleGatewayVolume,
      redisVolume,
      Workers,
      Frontends,
      resource,
    ],
  });
});
