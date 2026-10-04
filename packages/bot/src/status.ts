import type { ChatAdapter, ChatThread } from "./types.js";

/**
 * One state of a request, worded for a status message and for a native indicator, which the
 * platform shows after the bot's name ("Acme Agent is working on it…"). An empty indicator
 * hides it, e.g. while a prompt waits for a person.
 */
export type StatusText = { message: string; indicator: string };

export const WORKING: StatusText = { message: "Working on it…", indicator: "is working on it…" };
export const WAITING_FOR_APPROVAL: StatusText = {
  message: "Waiting for approval below…",
  indicator: "",
};
export const WAITING_FOR_ANSWER: StatusText = {
  message: "Waiting for an answer below…",
  indicator: "",
};

// Slack drops an indicator after two minutes without a reply, and every bot message in the
// thread (a prompt, a hint) clears it; re-showing it on each tick covers both.
const TICK_MS = 60_000;

export const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const noop = () => undefined;

export type StatusLine = {
  /** The status message, when the platform shows no native indicator. */
  readonly messageId: string | undefined;
  set(status: StatusText): void;
  /** Replace the status with a final line, e.g. an error. */
  finish(text: string): Promise<void>;
  /** The answer was posted; take the status away. */
  remove(): Promise<void>;
  stop(): void;
};

/**
 * The single status of a request: the platform's native indicator when it has one, otherwise
 * a message that is edited as the request progresses. `messageId` resumes a status message
 * left by a previous process.
 */
export async function openStatusLine(
  adapter: ChatAdapter,
  thread: ChatThread,
  messageId?: string,
): Promise<StatusLine> {
  const native =
    !messageId && adapter.indicate
      ? await adapter.indicate(thread, WORKING.indicator).catch(() => false)
      : false;
  const id = native ? undefined : (messageId ?? (await adapter.post(thread, WORKING.message)));
  const startedAt = Date.now();
  let current = WORKING;
  let done = false;

  const elapsed = () => {
    const ms = Date.now() - startedAt;
    return ms >= TICK_MS ? ` (${minutes(ms)} min)` : "";
  };
  const render = () => {
    if (id) return adapter.edit(thread, id, `${current.message}${elapsed()}`).catch(noop);
    const text = current.indicator && `${current.indicator}${elapsed()}`;
    return adapter.indicate?.(thread, text).catch(noop);
  };
  const timer = setInterval(() => {
    if (id || current.indicator) void render();
  }, TICK_MS);
  // Prompts can close after the run ended; nothing may overwrite the final line.
  const end = () => {
    done = true;
    clearInterval(timer);
  };

  return {
    messageId: id,
    set(next) {
      if (done || next === current) return;
      current = next;
      void render();
    },
    async finish(text) {
      end();
      if (id) {
        await adapter.edit(thread, id, text).catch(noop);
        return;
      }
      await adapter.indicate?.(thread, "").catch(noop);
      await adapter.post(thread, text).catch(noop);
    },
    async remove() {
      end();
      if (id) await adapter.remove(thread, id).catch(noop);
      else await adapter.indicate?.(thread, "").catch(noop);
    },
    stop: end,
  };
}
