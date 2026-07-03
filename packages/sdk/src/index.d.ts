/**
 * Hand-maintained public type surface for @gitterm/sdk.
 *
 * External npm consumers resolve these types instead of the TypeScript
 * sources, because the sources derive types from the private @gitterm/api
 * router. Keep this file in sync with src/types.ts and src/client.ts.
 *
 * TODO: replace with generated declarations once the AppRouter types can be
 * bundled into a standalone .d.ts.
 */

export const DEFAULT_GITTERM_SERVER_URL: string;

export type CliConfig = {
  serverUrl: string;
  token: string;
  createdAt: number;
};

export type GittermErrorCode =
  | "NOT_LOGGED_IN"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "NETWORK";

export class GittermError extends Error {
  readonly code: GittermErrorCode;
  readonly cause?: unknown;
  constructor(code: GittermErrorCode, message: string, options?: { cause?: unknown });
}

export type GittermClientOptions = {
  serverUrl?: string;
  token?: string;
  configPath?: string;
  fetch?: typeof fetch;
};

export type AuthStatus = {
  loggedIn: true;
  userId: string;
  email: string;
  name: string;
  plan: string;
  authMethod: "session" | "apiToken";
};

export type WorkspaceStatus = "pending" | "running" | "stopped" | "terminated";
export type WorkspaceHostingType = "cloud" | "local";

export type Workspace = {
  id: string;
  name: string | null;
  status: WorkspaceStatus;
  repositoryUrl: string | null;
  repositoryBranch: string | null;
  domain: string;
  subdomain: string | null;
  persistent: boolean;
  hostingType: WorkspaceHostingType;
  serverOnly: boolean;
  workspaceProfile: string;
  cloudProviderId: string;
  agentType: { id: string; name: string; description: string | null } | null;
  image: { id: string; name: string; imageId: string } | null;
  startedAt: string | null;
  stoppedAt: string | null;
  terminatedAt: string | null;
  lastActiveAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceListOptions = {
  limit?: number;
  offset?: number;
  status?: "all" | "active" | "terminated";
};

export type WorkspaceListResult = {
  workspaces: Workspace[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

export type WorkspaceCreateInput = {
  name?: string;
  repo?: string;
  branch?: string;
  subdomain?: string;
  agentTypeId: string;
  cloudProviderId: string;
  regionId?: string;
  gitIntegrationId?: string;
  persistent: boolean;
  workspaceProfile?: "standard" | "ssh-enabled";
};

export type WorkspaceStopResult = { durationMinutes: number };
export type WorkspaceRestartResult = { status: WorkspaceStatus };
export type WorkspaceTerminateResult = {
  workspace: Workspace | null;
  cleanupInBackground: boolean;
};

export type AgentType = {
  id: string;
  name: string;
  description: string | null;
  serverOnly: boolean;
  isEnabled: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type CloudProvider = Record<string, unknown> & {
  id: string;
  name: string;
  providerKey: string;
  regions?: Array<Record<string, unknown>>;
};

export type GittermClient = {
  serverUrl: string;
  auth: {
    status(): Promise<AuthStatus>;
  };
  workspaces: {
    list(input?: WorkspaceListOptions): Promise<WorkspaceListResult>;
    get(workspaceId: string): Promise<Workspace>;
    stop(workspaceId: string): Promise<WorkspaceStopResult>;
    restart(workspaceId: string): Promise<WorkspaceRestartResult>;
    terminate(workspaceId: string): Promise<WorkspaceTerminateResult>;
    create(input: WorkspaceCreateInput): Promise<Workspace>;
  };
  catalog: {
    agentTypes(input?: { serverOnly?: boolean }): Promise<AgentType[]>;
    cloudProviders(input?: {
      localOnly?: boolean;
      cloudOnly?: boolean;
      sandboxOnly?: boolean;
      nonSandboxOnly?: boolean;
    }): Promise<CloudProvider[]>;
  };
};

export function createGittermClient(options?: GittermClientOptions): GittermClient;
export function getConfigPath(configPath?: string): string;
export function loadConfig(configPath?: string): Promise<CliConfig | null>;
export function loadConfigSync(configPath?: string): CliConfig | null;
export function saveConfig(config: CliConfig, configPath?: string): Promise<void>;
export function deleteConfig(configPath?: string): Promise<void>;

export type DeviceCodeInfo = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

export type LoginWithDeviceCodeOptions = {
  clientName?: string;
  fetch?: typeof fetch;
  onCode?: (code: Omit<DeviceCodeInfo, "deviceCode">) => void | Promise<void>;
};

export function loginWithDeviceCode(
  serverUrl: string,
  options?: LoginWithDeviceCodeOptions,
): Promise<{ token: string }>;
