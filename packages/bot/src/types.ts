import type {
  AgentPermissionRequest,
  AgentQuestion,
  GittermClient,
  GittermClientOptions,
  WorkspaceCreateInput,
} from "@gitterm/sdk";

/** A conversation: the channel and the thread inside it. Every thread is one agent session. */
export type ChatThread = { channel: string; thread: string };

export type ChatUser = { id: string; name: string };

/** A file posted in the chat. Only images are forwarded to the agent; the rest are named. */
export type ChatFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Base64 content. Called only for files the bot forwards. */
  download(): Promise<string>;
};

export type ChatMessage = {
  /** Platform message id (Slack `ts`, Discord snowflake). */
  id: string;
  thread: ChatThread;
  author: ChatUser;
  /** Text with the bot's own mention removed. */
  text: string;
  files: ChatFile[];
  /** The bot was mentioned. Other thread replies only answer an open question. */
  mentioned: boolean;
  /** The thread existed before this message, so it may hold earlier context. */
  inThread: boolean;
};

/** A message read back from a thread to give a new or continued session its context. */
export type HistoryMessage = {
  id: string;
  author: ChatUser;
  /** Written by this bot (status lines, earlier answers) or another bot. */
  fromBot: boolean;
  text: string;
  files: ChatFile[];
};

/** Something the agent is blocked on, shown in the thread with buttons. */
export type ChatPrompt =
  | {
      id: string;
      kind: "question";
      question: AgentQuestion;
      /** Position among the questions the agent asked together; they are shown one at a time. */
      index: number;
      total: number;
      requester: ChatUser;
    }
  | { id: string; kind: "permission"; request: AgentPermissionRequest; requester: ChatUser };

export type ChatAnswer =
  | { kind: "question"; labels: string[] }
  | { kind: "permission"; response: "once" | "always" | "reject" };

/** What the engine gives an adapter to report chat activity. */
export type ChatEvents = {
  message(message: ChatMessage): void;
  /** Button, menu, or dialog answer. False when the prompt is no longer open. */
  answer(promptId: string, answer: ChatAnswer, by: ChatUser): boolean;
  /** The open prompt, e.g. to build a free-text dialog for it; undefined once settled. */
  prompt(promptId: string): ChatPrompt | undefined;
  /** Whether the bot works in this channel, so adapters do not open threads elsewhere. */
  accepts(channel: string): boolean;
};

/**
 * The chat platform half of a bot. `@gitterm/slack-bot` and `@gitterm/discord-bot` implement it;
 * implement it yourself to put the same agent behind another chat platform.
 */
export interface ChatAdapter {
  /** e.g. "slack"; tags the bot's workspaces and appears in prompts. */
  readonly platform: string;
  /** Human-readable platform name for prompts and instructions, e.g. "Slack". */
  readonly displayName: string;
  /**
   * Connect and start reporting events. Resolves with the id of the installation (Slack team,
   * Discord application) so two installations never share a sandbox.
   */
  start(events: ChatEvents): Promise<{ scope: string }>;
  stop(): Promise<void>;
  /** The thread's messages oldest first; only those after `after` when it is given. */
  history(thread: ChatThread, after: string | undefined): Promise<HistoryMessage[]>;
  /** Post a short plain status line; resolves with its message id. */
  post(thread: ChatThread, text: string): Promise<string>;
  edit(thread: ChatThread, messageId: string, text: string): Promise<void>;
  remove(thread: ChatThread, messageId: string): Promise<void>;
  /** The agent's answer as Markdown; the adapter converts and splits it for the platform. */
  reply(thread: ChatThread, markdown: string, footer: string): Promise<void>;
  /** Show a prompt with controls that call `ChatEvents.answer`; resolves with its message id. */
  ask(thread: ChatThread, prompt: ChatPrompt): Promise<string>;
  /** Replace the prompt's controls with its outcome once it is answered or abandoned. */
  settle(thread: ChatThread, messageId: string, prompt: ChatPrompt, outcome: string): Promise<void>;
  /**
   * Show the platform's native "working" indicator in the thread (e.g. "Acme Agent is working
   * on it…"); an empty status hides it. Resolve false when the platform refuses, and the engine
   * keeps a status message instead. Optional.
   */
  indicate?(thread: ChatThread, status: string): Promise<boolean>;
  /** React to an accepted message (e.g. 👀) so people know it was seen while it waits its turn. */
  acknowledge?(message: ChatMessage): Promise<void>;
}

/** A repository, optionally with a branch: `https://github.com/acme/app` or `…/app#develop`. */
export type RepoTarget = string | { url: string; branch?: string };

export type ModelChoice = {
  /** OpenCode `provider/model`, e.g. `anthropic/claude-sonnet-5-5`. */
  id: string;
  /** Label of a saved dashboard credential. Default: the provider's default credential. */
  credential?: string;
  /** An API key for this bot only; injected into the sandbox, never saved in the dashboard. */
  apiKey?: string;
};

/** Workspace settings the bot does not decide itself. */
export type WorkspaceOverrides = Omit<
  WorkspaceCreateInput,
  "repo" | "branch" | "metadata" | "name" | "agent" | "connections"
>;

export type BotLogger = Pick<Console, "info" | "warn" | "error">;

export type BotOptions = {
  adapter: ChatAdapter;
  /** A client, or options for one. Defaults to `GITTERM_API_TOKEN` / `GITTERM_SERVER_URL`. */
  gitterm?: GittermClient | GittermClientOptions;
  /** Repository for every channel without its own entry in `channels`. */
  repo?: RepoTarget;
  /** Per-channel repositories. Without `repo`, the bot only works in these channels. */
  channels?: Record<string, RepoTarget>;
  /**
   * GitTerm connections to attach to new sandboxes, by id or name. `"auto"` (default) attaches
   * the GitHub connection for the repository's owner (or the shared one) and every connected
   * MCP and Executor connection.
   */
  connections?: "auto" | string[];
  /**
   * The model for every run, as OpenCode `provider/model`. Only that provider's credential
   * reaches new sandboxes: its dashboard default, the saved credential labelled `credential`, or
   * an inline `apiKey`. Without a model, sandboxes get every saved dashboard credential.
   */
  model?: string | ModelChoice;
  /** Extra agent instructions, appended to the bot's own. Applies to new sandboxes. */
  instructions?: string;
  /** Provider, image, setup, OpenCode config, and other workspace settings for new sandboxes. */
  workspace?: WorkspaceOverrides;
  /** Thread sessions and in-flight requests. Default `.gitterm-bot/<platform>.json`. */
  stateFile?: string;
  /** Total time for one request, including time spent waiting for answers. Default 60 min. */
  runTimeoutMs?: number;
  /** How long a question or permission prompt waits for an answer. Default 30 min. */
  inputTimeoutMs?: number;
  logger?: BotLogger;
};

export type Bot = {
  start(): Promise<void>;
  stop(): Promise<void>;
};
