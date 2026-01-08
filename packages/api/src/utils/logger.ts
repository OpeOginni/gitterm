/**
 * Structured logger for workspace and billing events
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface WorkspaceLogContext {
  workspaceId?: string;
  userId?: string;
  action?: string;
  provider?: string;
  region?: string;
  durationMinutes?: number;
  stopSource?: string;
  installationId?: string;
  error?: string;
}

export interface AgentLoopLogContext {
  loopId?: string;
  runId?: string;
  runNumber?: number;
  userId?: string;
  action?: string;
  sandboxId?: string;
  commitSha?: string;
  durationSeconds?: number;
  isComplete?: boolean;
  acknowledged?: boolean;
  error?: string;
  status?: string;
  totalRuns?: number;
  maxRuns?: number;
}

export type LogContext = WorkspaceLogContext | AgentLoopLogContext;

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export const logger = {
  info: (message: string, context?: LogContext) => {
    console.log(formatLog("info", message, context));
  },

  warn: (message: string, context?: LogContext) => {
    console.warn(formatLog("warn", message, context));
  },

  error: (message: string, context?: LogContext, error?: Error) => {
    console.error(formatLog("error", message, context));
    if (error) {
      console.error(error);
    }
  },

  debug: (message: string, context?: LogContext) => {
    console.log(formatLog("debug", message, context));
  },

  // Specific event loggers for observability
  workspaceStarted: (workspaceId: string, userId: string, provider: string) => {
    logger.info("Workspace started", { workspaceId, userId, provider, action: "start" });
  },

  workspaceStopped: (
    workspaceId: string,
    userId: string,
    stopSource: string,
    durationMinutes: number,
  ) => {
    logger.info("Workspace stopped", {
      workspaceId,
      userId,
      stopSource,
      durationMinutes,
      action: "stop",
    });
  },

  workspaceRestarted: (workspaceId: string, userId: string) => {
    logger.info("Workspace restarted", { workspaceId, userId, action: "restart" });
  },

  heartbeatReceived: (workspaceId: string, action: string) => {
    logger.debug("Heartbeat received", { workspaceId, action: "heartbeat" });
  },

  quotaExhausted: (userId: string) => {
    logger.warn("User quota exhausted", { userId, action: "quota_check" });
  },

  quotaWorkspaceFound: (workspaceId: string, userId: string) => {
    logger.info("Workspace found with exceeded quota", {
      workspaceId,
      userId,
      action: "quota_enforcement",
    });
  },

  idleWorkspaceFound: (workspaceId: string, userId: string) => {
    logger.info("Idle workspace detected", { workspaceId, userId, action: "idle_check" });
  },
};
