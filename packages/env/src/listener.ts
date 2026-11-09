/**
 * Listener Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/listener';
 */

import { z, parseEnv, port, optional, nodeEnv } from "./index";

const schema = z.object({
  NODE_ENV: nodeEnv,
  PORT: port.default(3000),

  BASE_DOMAIN: z.string().default("gitterm.dev"),
  CORS_ORIGIN: optional,

  // Server communication (required for internal API calls)
  SERVER_URL: optional,
  INTERNAL_API_KEY: optional,
});

export type ListenerEnv = z.infer<typeof schema>;

const env = parseEnv(schema);
export default env;

export { schema as listenerEnvSchema };
