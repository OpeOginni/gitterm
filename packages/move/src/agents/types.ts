import type { Machine } from "../machine.js";

/** A session as an agent's `export` returns it. */
export type ExportedSession = {
  /** The agent's own reference: a T3 thread id, a Pi session id. */
  ref: string;
  /** The directory the session runs in. */
  cwd: string;
  title: string;
  /** The session's size when exported; with `sentSince`, tells whether it changed later. */
  mark: number;
  /** What `import` needs, opaque to the flows. */
  payload: Record<string, unknown>;
};

/** The operations every agent provides for its sessions, on one machine. */
export interface SessionOps {
  /** The agent's version there. */
  info(): Promise<{ version: string }>;
  export(input: { ref: string; allowBusy?: boolean }): Promise<ExportedSession>;
  /** Writes a session for `cwd`: a new one, or with `ref` that session replaced in place. */
  import(input: {
    payload: Record<string, unknown>;
    cwd: string;
    ref?: string;
  }): Promise<{ ref: string }>;
  /** Starts the agent on the message, without waiting. */
  notify(input: { ref: string; message: string; where: "cloud" | "local" }): Promise<void>;
  status(input: { ref: string }): Promise<{ busy: boolean }>;
  /** Stops a working session and waits until it stays stopped. Returns whether anything ran. */
  stop?(input: { ref: string }): Promise<boolean>;
}

/** How to reach a workspace's agent: its public URL and credentials, and its checkout. */
export type WorkspaceRuntime = {
  url: string;
  directory: string;
  headers?: Record<string, string>;
  password?: string;
};

/** What the agent's workspace adds once a session moved, kept to undo on the way back. */
export type Connection = {
  /** Where to open the moved session, as text the agent can print. */
  links: Record<string, string>;
  warnings: string[];
  /** Kept in the move record and handed to `disconnect`. */
  state?: Record<string, string>;
};

/**
 * One coding agent: how its sessions are found, copied and resumed on another machine. The
 * move and return flows are the same for every agent; only this differs.
 */
export interface AgentAdapter {
  /** The GitTerm agent a workspace runs for it (`AgentProvisionerKey`). */
  key: string;
  label: string;
  /** The script behind `session`, for agents whose operations run as one (`agentScript`). */
  script?: string;
  /** The agent's session operations on a machine (see `scriptSession` for script agents). */
  session(machine: Machine): SessionOps;
  /**
   * Reaches the workspace through the agent's own server instead of GitTerm's command endpoint,
   * which some providers lack.
   */
  remote?(runtime: WorkspaceRuntime): Machine;
  /** The session the calling process belongs to, when an agent runs the CLI itself. */
  currentSession(env: NodeJS.ProcessEnv): string | undefined;
  /** Whether a real user message was added to a session after `mark`. */
  sentSince(session: ExportedSession, mark: number): boolean;
  /**
   * Set when a session can't be returned from inside itself (the agent would write over the
   * returned session): the message saying what to do instead.
   */
  insideReturn?: string;
  /** Optional setup on this machine, run by `gitterm setup`. Returns what changed. */
  setup?(local: Machine): Promise<string[]>;
  /** Optional link between the workspace and this machine's agent, after a move. */
  connect?(input: {
    local: Machine;
    remote: Machine;
    url: string;
    cwd: string;
    ref: string;
  }): Promise<Connection>;
  /** Undoes `connect` when the session comes back. */
  disconnect?(state: Record<string, string>): Promise<void>;
  /** A link that opens a session on this machine, if the agent has one. */
  link?(local: Machine, ref: string): Promise<string | undefined>;
}
