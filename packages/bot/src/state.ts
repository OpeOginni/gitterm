import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatThread, ChatUser } from "./types.js";

/** The run a thread continues from and the last chat message it has seen. */
export type ThreadSession = {
  /** The repository the thread works on, chosen by its first message. */
  repo: string;
  workspaceId: string;
  runId: string;
  lastMessageId: string;
  updatedAt: number;
};

/** A request being worked on, so a restarted bot can pick its run up again. */
export type InFlightRequest = {
  thread: ChatThread;
  /** The status message; absent when the platform showed a native indicator instead. */
  statusId?: string;
  requester: ChatUser;
  repo: string;
  /** Set once the run exists; before that a restart can only report the request as lost. */
  run?: { workspaceId: string; id: string };
};

type State = {
  sessions: Record<string, ThreadSession>;
  inFlight: Record<string, InFlightRequest>;
};

export type StateStore = {
  session(threadKey: string): ThreadSession | undefined;
  setSession(threadKey: string, session: Omit<ThreadSession, "updatedAt">): Promise<void>;
  inFlight(): Record<string, InFlightRequest>;
  setInFlight(threadKey: string, request: InFlightRequest | undefined): Promise<void>;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * Holds GitTerm workspace/run ids only, never tokens, written atomically with mode 0600.
 * It is a cache: losing it costs thread continuity, not sandboxes, which are found by metadata.
 */
export async function openStateStore(file: string): Promise<StateStore> {
  const loaded: Partial<State> = await readFile(file, "utf8")
    .then((raw) => JSON.parse(raw) as Partial<State>)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
  const cutoff = Date.now() - SESSION_TTL_MS;
  const state: State = {
    sessions: Object.fromEntries(
      Object.entries(loaded.sessions ?? {}).filter(([, session]) => session.updatedAt > cutoff),
    ),
    inFlight: loaded.inFlight ?? {},
  };

  let queue = Promise.resolve();
  const persist = () => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, file);
      });
    return queue;
  };

  return {
    session: (threadKey) => state.sessions[threadKey],
    setSession: (threadKey, session) => {
      state.sessions[threadKey] = { ...session, updatedAt: Date.now() };
      return persist();
    },
    inFlight: () => ({ ...state.inFlight }),
    setInFlight: (threadKey, request) => {
      if (request) state.inFlight[threadKey] = request;
      else delete state.inFlight[threadKey];
      return persist();
    },
  };
}

/** Run operations with the same key one after another. */
export function createLocks() {
  const locks = new Map<string, Promise<unknown>>();
  return <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
    locks.set(key, next);
    void next
      .finally(() => {
        if (locks.get(key) === next) locks.delete(key);
      })
      .catch(() => undefined);
    return next;
  };
}
