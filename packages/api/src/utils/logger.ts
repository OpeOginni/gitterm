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
}

function formatLog(level: LogLevel, message: string, context?: WorkspaceLogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export const logger = {
  info: (message: string, context?: WorkspaceLogContext) => {
    console.log(formatLog("info", message, context));
  },
  
  warn: (message: string, context?: WorkspaceLogContext) => {
    console.warn(formatLog("warn", message, context));
  },
  
  error: (message: string, context?: WorkspaceLogContext, error?: Error) => {
    console.error(formatLog("error", message, context));
    if (error) {
      console.error(error);
    }
  },
  
  debug: (message: string, context?: WorkspaceLogContext) => {
    if (process.env.DEBUG === "true") {
      console.log(formatLog("debug", message, context));
    }
  },

  // Specific event loggers for observability
  workspaceStarted: (workspaceId: string, userId: string, provider: string) => {
    logger.info("Workspace started", { workspaceId, userId, provider, action: "start" });
  },

  workspaceStopped: (workspaceId: string, userId: string, stopSource: string, durationMinutes: number) => {
    logger.info("Workspace stopped", { workspaceId, userId, stopSource, durationMinutes, action: "stop" });
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

  idleWorkspaceFound: (workspaceId: string, userId: string) => {
    logger.info("Idle workspace detected", { workspaceId, userId, action: "idle_check" });
  },
};

