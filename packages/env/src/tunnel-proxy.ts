/**
 * Tunnel Proxy Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/tunnel-proxy';
 */

import { z, parseEnv, port, routingMode, optional, nodeEnv } from "./index";

const schema = z.object({
  NODE_ENV: nodeEnv,
  PORT: port.default(9000),
  INSTANCE_ID: z.string().default("local-dev"),

  ROUTING_MODE: routingMode,
  REDIS_URL: optional,
  TUNNEL_JWT_SECRET: optional,
  INTERNAL_API_KEY: optional,
  SERVER_URL: optional,
});

export type TunnelProxyEnv = z.infer<typeof schema>;

const env = parseEnv(schema);
export default env;

export const isSubdomainRouting = () => env.ROUTING_MODE === "subdomain";
export const isPathRouting = () => env.ROUTING_MODE === "path";

export { schema as tunnelProxyEnvSchema };
