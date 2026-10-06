/**
 * Worker Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/worker';
 */

import {
  z,
  parseEnv,
  deploymentMode,
  optional,
  boolWithDefault,
  intWithDefault,
  nodeEnv,
} from "./index";

const schema = z.object({
  NODE_ENV: nodeEnv,
  DEPLOYMENT_MODE: deploymentMode,

  SERVER_URL: optional,
  INTERNAL_API_KEY: optional,

  ENABLE_IDLE_REAPING: boolWithDefault(true),

  // Minutes between reap passes. 0 = run once and exit (Railway Cron mode).
  // Any positive value = loop forever, sleeping between passes (self-host/Docker mode).
  REAP_INTERVAL_MINUTES: intWithDefault(0),
});

export type WorkerEnv = z.infer<typeof schema>;

const env = parseEnv(schema);
export default env;

export const isManaged = () => env.DEPLOYMENT_MODE === "managed";
export const shouldReapIdleWorkspaces = () => env.ENABLE_IDLE_REAPING;

export { schema as workerEnvSchema };
