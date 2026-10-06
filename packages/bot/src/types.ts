import type {
  AgentPermissionRequest,
  AgentQuestion,
  GittermClient,
  GittermClientOptions,
  WorkspaceCreateInput,
} from "@gitterm/sdk";

/** A conversation: the channel and the thread inside it. Every thread is one agent session. */
export type ChatThread = { channel: string; thread: string };

export type ChatUser = {
  id: string;
  name: string;
  /**
   * Not a full member of the workspace (Slack guests and people from other organisations in
   * shared channels). Guests cannot use the bot unless `allowGuests` is set.
   */
  guest?: boolean;
};

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
  /**
   * A one-to-one conversation with the bot. It gets its own sandbox, so the agent there can't
   * see the sessions other people run in channels.
   */
  direct?: boolean;
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
  /**
   * Button, menu, or dialog answer. `stale` when the prompt is no longer open, `forbidden` when
   * this person may not use the bot; adapters tell the clicker privately.
   */
  answer(promptId: string, answer: ChatAnswer, by: ChatUser): "answered" | "stale" | "forbidden";
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
  /**
   * React to a request's message: `seen` when accepted (e.g. 👀, so people know it waits its
   * turn), then `done` (✅) or `failed` (❌). Optional.
   */
  mark?(message: ChatMessage, state: "seen" | "done" | "failed"): Promise<void>;
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
  /** Per-channel repositories. Without `repo` or `repos`, the bot only works in these channels. */
  channels?: Record<string, RepoTarget>;
  /**
   * More repositories people can pick by naming them in a thread's first message, e.g.
   * "@bot in acme/api, why is login slow?". A channel without a repository asks which one.
   */
  repos?: RepoTarget[];
  /**
   * Tools to attach to new sandboxes besides GitHub: connection names as shown under
   * Integrations (`"Linear"`), integration keys (`"executor"`), or ids. GitHub access for the
   * repository is attached automatically.
   */
  connections?: string[];
  /** Environment variables for new sandboxes, e.g. test credentials. Never logged. */
  env?: Record<string, string>;
  /** Shell commands run in the checkout before the agent starts in a new sandbox. */
  setup?: string[];
  /** Platform user ids allowed to use the bot. Default: everyone in channels it can see. */
  allowedUsers?: string[];
  /** Let guests and people from other organisations use the bot. Default false. */
  allowGuests?: boolean;
  /**
   * The model for every run, as OpenCode `provider/model`. Only that provider's credential
   * reaches new sandboxes: its dashboard default, the saved credential labelled `credential`, or
   * an inline `apiKey`. Without a model, sandboxes get every saved dashboard credential.
   */
  model?: string | ModelChoice;
  /** What the agent should know and how to behave, after the bot's own rules. New sandboxes. */
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
