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
  DATABASE_URL: optional,
  RAILWAY_PROJECT_ID: optional,
  CORS_ORIGIN: optional,
});

export type ListenerEnv = z.infer<typeof schema>;

const env = parseEnv(schema);
export default env;

export { schema as listenerEnvSchema };
