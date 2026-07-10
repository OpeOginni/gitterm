export { createGittermClient, type GittermClient, type GittermClientOptions } from "./client.js";
export {
  DEFAULT_GITTERM_SERVER_URL,
  getConfigPath,
  loadConfig,
  loadConfigSync,
  saveConfig,
  deleteConfig,
} from "./config.js";
export type { CliConfig } from "./config.js";
export { loginWithDeviceCode } from "./device-login.js";
export type { DeviceCodeInfo, LoginWithDeviceCodeOptions } from "./device-login.js";
export { GittermError } from "./errors.js";
export type { GittermErrorCode } from "./errors.js";
export type {
  AgentType,
  AuthStatus,
  CloudProvider,
  Workspace,
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceEnsureRunningResult,
  WorkspaceHostingType,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceRestartResult,
  WorkspaceRuntimeAccess,
  WorkspaceStatus,
  WorkspaceStopResult,
  WorkspacePauseResult,
  WorkspaceTerminateResult,
} from "./types.js";
