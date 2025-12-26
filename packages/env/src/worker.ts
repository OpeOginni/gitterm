/**
 * Worker Environment Configuration
 *
 * Usage:
 *   import env from '@gitterm/env/worker';
 */

import { z, parseEnv, deploymentMode, optional, boolWithDefault, nodeEnv } from "./index";

const schema = z.object({
  NODE_ENV: nodeEnv,
  DEPLOYMENT_MODE: deploymentMode,

  SERVER_URL: optional,
  INTERNAL_API_KEY: optional,

  ENABLE_IDLE_REAPING: boolWithDefault(true),
  ENABLE_QUOTA_ENFORCEMENT: boolWithDefault(false),
});

export type WorkerEnv = z.infer<typeof schema>;

const env = parseEnv(schema);
export default env;

export const isManaged = () => env.DEPLOYMENT_MODE === "managed";
export const shouldReapIdleWorkspaces = () => env.ENABLE_IDLE_REAPING;
export const shouldEnforceQuotas = () => env.ENABLE_QUOTA_ENFORCEMENT || isManaged();

export { schema as workerEnvSchema };
