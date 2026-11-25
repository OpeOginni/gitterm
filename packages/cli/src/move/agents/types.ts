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
  /** Operations run on both machines; see `agentScript`. */
  script: string;
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
