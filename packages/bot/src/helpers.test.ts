import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentQuestion, ModelCredential } from "@gitterm/sdk";
import { botOptionsFromEnv } from "./env.js";
import { splitMessage, tablesToCode } from "./markdown.js";
import {
  agentInstructions,
  buildPrompt,
  interpretPermissionReply,
  interpretTypedAnswer,
} from "./prompt.js";
import { spaceOf } from "./workspaces.js";
import type { ChatFile } from "./types.js";
import { modelsFor, parseRepo, repoLabel } from "./workspaces.js";
import type { GittermClient, SavedBot } from "@gitterm/sdk";
import { withSavedConfig } from "./saved.js";

const quietLog = { info() {}, warn() {}, error() {} };

const image = (id: string, size = 100): ChatFile => ({
  id,
  name: `${id}.png`,
  mime: "image/png",
  size,
  download: async () => "",
});

describe("repositories", () => {
  test("parses a branch after #", () => {
    expect(parseRepo("https://github.com/acme/app#develop")).toEqual({
      url: "https://github.com/acme/app",
      branch: "develop",
    });
    expect(parseRepo({ url: "https://github.com/acme/app" }).branch).toBeUndefined();
    expect(repoLabel(parseRepo("https://github.com/acme/app.git"))).toBe("acme/app");
  });
});

describe("answers", () => {
  const question: AgentQuestion = {
    key: "q",
    header: "",
    question: "",
    options: [
      { label: "Red", description: "" },
      { label: "Blue", description: "" },
    ],
    multiple: false,
    custom: true,
  };

  test("typed answers map numbers and labels to options", () => {
    expect(interpretTypedAnswer(question, "2")).toEqual(["Blue"]);
    expect(interpretTypedAnswer(question, "red")).toEqual(["Red"]);
    expect(interpretTypedAnswer(question, "1, 2")).toEqual(["1, 2"]);
    expect(interpretTypedAnswer({ ...question, multiple: true }, "1, 2")).toEqual(["Red", "Blue"]);
    expect(interpretTypedAnswer({ ...question, custom: false }, "green")).toBeNull();
  });

  test("permission replies", () => {
    expect(interpretPermissionReply("Yes!")).toBe("once");
    expect(interpretPermissionReply("always")).toBe("always");
    expect(interpretPermissionReply("no")).toBe("reject");
    expect(interpretPermissionReply("maybe")).toBeNull();
  });
});

describe("buildPrompt", () => {
  test("budgets aggregate encoded size and prioritizes requester screenshots", () => {
    const prompt = buildPrompt({
      platform: "Slack",
      continued: false,
      message: {
        id: "request",
        thread: { channel: "C", thread: "T" },
        author: { id: "U", name: "User" },
        text: "look",
        files: [image("request", 5_000_000)],
        mentioned: true,
        inThread: true,
      },
      history: [
        {
          id: "earlier",
          author: { id: "U", name: "User" },
          fromBot: false,
          text: "old",
          files: Array.from({ length: 10 }, (_, i) => image(`old${i}`, 5_000_000)),
        },
      ],
    });
    expect(prompt.images[0]?.id).toBe("request");
    expect(
      prompt.images.reduce((size, file) => size + 4 * Math.ceil(file.size / 3), 0),
    ).toBeLessThanOrEqual(20_000_000);
    expect(prompt.images).toHaveLength(2);
  });

  test("channels, guilds and private conversations are distinct by default", () => {
    const one = { tenant: "G1", thread: { channel: "C1" } };
    expect(spaceOf(one)).not.toBe(spaceOf({ ...one, tenant: "G2" }));
    expect(spaceOf(one)).not.toBe(spaceOf({ ...one, thread: { channel: "C2" } }));
    expect(spaceOf(one)).not.toBe(spaceOf({ ...one, direct: true }));
    expect(spaceOf(one, true)).toBe(spaceOf({ ...one, thread: { channel: "C2" } }, true));
    expect(agentInstructions("Slack", undefined)).toContain("use a separate git worktree");
    const owned = agentInstructions("Slack", "  Always ask how they are.  ");
    expect(owned).toEndWith(
      "## Instructions from this bot's owner\n\nThese take precedence over the defaults above.\n\nAlways ask how they are.",
    );
    expect(agentInstructions("Slack", "   ")).toBe(agentInstructions("Slack", undefined));
  });
  test("quotes unseen thread messages and attaches each image once", () => {
    const prompt = buildPrompt({
      platform: "Slack",
      continued: false,
      message: {
        id: "3",
        thread: { channel: "C", thread: "1" },
        author: { id: "U1", name: "Alice" },
        text: "what is this?",
        files: [image("a")],
        mentioned: true,
        inThread: true,
      },
      history: [
        {
          id: "1",
          author: { id: "U2", name: "Bob" },
          fromBot: false,
          text: "screenshot",
          files: [image("a"), image("big", 9_000_000)],
        },
        { id: "2", author: { id: "B", name: "assistant" }, fromBot: true, text: "hi", files: [] },
      ],
    });
    expect(prompt.images.map((file) => file.id)).toEqual(["a"]);
    expect(prompt.text).toContain("Slack message from Alice (Slack user U1).");
    expect(prompt.text).toContain(
      "Bob: screenshot [image attached: a.png] [file not forwarded: big.png]",
    );
    expect(prompt.text).toContain("assistant: hi");
    expect(prompt.text).toContain("Request: what is this? [image attached: a.png]");
  });
});

describe("markdown", () => {
  test("tables become code blocks", () => {
    const out = tablesToCode("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toBe("```\na   | b\n----+----\n1   | 2\n```");
  });

  test("splitting reopens a code block cut in two", () => {
    const text = [
      "intro",
      "```ts",
      ...Array.from({ length: 30 }, (_, i) => `line ${i}`),
      "```",
    ].join("\n");
    const chunks = splitMessage(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
    expect(chunks.join("\n").replaceAll("\n```\n```ts", "")).toContain("line 29");
  });
});

describe("botOptionsFromEnv", () => {
  test("reads repositories, channels, and connections", () => {
    expect(
      botOptionsFromEnv({
        GITTERM_BOT_REPO: "https://github.com/acme/app",
        GITTERM_BOT_CHANNELS: "C1=https://github.com/acme/api#main, C2=https://github.com/acme/web",
        GITTERM_BOT_CONNECTIONS: "Linear, executor",
        GITTERM_BOT_REPOS: "https://github.com/acme/web",
        GITTERM_BOT_ALLOWED_USERS: "U1,U2",
        GITTERM_BOT_PROVIDER: "railway",
        GITTERM_BOT_RUN_TIMEOUT_MINUTES: "20",
      }),
    ).toEqual({
      repo: "https://github.com/acme/app",
      channels: { C1: "https://github.com/acme/api#main", C2: "https://github.com/acme/web" },
      connections: ["Linear", "executor"],
      repos: ["https://github.com/acme/web"],
      allowedUsers: ["U1", "U2"],
      workspace: { provider: { type: "railway" } },
      runTimeoutMs: 20 * 60_000,
    });
  });

  test("passes your own GitHub token as repository credentials", () => {
    expect(
      botOptionsFromEnv({ GITTERM_BOT_GITHUB_TOKEN: "ghp_x", GITTERM_BOT_PROVIDER: "e2b" })
        .workspace,
    ).toEqual({ provider: { type: "e2b" }, repositoryCredentials: { token: "ghp_x" } });
  });

  test("joins inline instructions with an instructions file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "gitterm-bot-")), "bot.md");
    writeFileSync(file, "# Team rules\n\nAnswer in German.\n");
    expect(
      botOptionsFromEnv({
        GITTERM_BOT_INSTRUCTIONS: "Be brief.",
        GITTERM_BOT_INSTRUCTIONS_FILE: file,
      }).instructions,
    ).toBe("Be brief.\n\n# Team rules\n\nAnswer in German.");
    expect(() => botOptionsFromEnv({ GITTERM_BOT_INSTRUCTIONS_FILE: `${file}.missing` })).toThrow(
      "Could not read the instructions file",
    );
  });
});

describe("modelsFor", () => {
  const credential = (patch: Partial<ModelCredential>) =>
    ({
      logicalProviderKey: "anthropic",
      label: "work",
      isActive: true,
      isDefault: false,
      ...patch,
    }) as ModelCredential;
  const model = { id: "anthropic/claude-sonnet-5-5" };

  test("ships only the chosen provider's default credential", () => {
    expect(
      modelsFor(model, [
        credential({ isDefault: true }),
        credential({ logicalProviderKey: "openai", isDefault: true }),
      ]),
    ).toEqual({
      default: "anthropic/claude-sonnet-5-5",
      providers: { anthropic: { source: "default" } },
    });
  });

  test("a label or an inline key picks the credential explicitly", () => {
    expect(modelsFor({ ...model, credential: "team" }, []).providers).toEqual({
      anthropic: { source: "saved", label: "team" },
    });
    expect(modelsFor({ ...model, apiKey: "sk-1" }, []).providers).toEqual({
      anthropic: { source: "apiKey", apiKey: "sk-1" },
    });
  });

  test("a provider with no saved credential gets none; several without a default must be chosen", () => {
    expect(modelsFor({ id: "opencode/big-pickle" }, [credential({})])).toEqual({
      default: "opencode/big-pickle",
    });
    expect(() => modelsFor(model, [credential({}), credential({ label: "home" })])).toThrow(
      'pick one with `credential` ("work", "home")',
    );
    expect(() => modelsFor({ id: "sonnet" }, [])).toThrow("provider/model");
  });
});

test("env reads the model with its credential", () => {
  expect(
    botOptionsFromEnv({
      GITTERM_BOT_MODEL: "openai/gpt-5",
      GITTERM_BOT_MODEL_CREDENTIAL: "team",
    }).model,
  ).toEqual({ id: "openai/gpt-5", credential: "team" });
  expect(() => botOptionsFromEnv({ GITTERM_BOT_MODEL_API_KEY: "sk" })).toThrow(
    "need GITTERM_BOT_MODEL",
  );
});

test("env reads a sandbox environment file", () => {
  const file = join(mkdtempSync(join(tmpdir(), "gitterm-bot-")), ".env.sandbox");
  writeFileSync(file, "DATABASE_URL=postgres://test\n# comment\nSTRIPE_KEY='sk_test'\n");
  expect(botOptionsFromEnv({ GITTERM_BOT_SANDBOX_ENV_FILE: file }).env).toEqual({
    DATABASE_URL: "postgres://test",
    STRIPE_KEY: "sk_test",
  });
});

describe("withSavedConfig", () => {
  const saved: SavedBot = {
    id: "b1",
    name: "Acme agent",
    platform: "slack",
    repo: "https://github.com/acme/app#main",
    model: "anthropic/claude-sonnet-5-5",
    credential: "work",
    connections: ["Linear"],
    provider: "e2b",
    githubAccess: "connection",
    channels: [],
    allowedUsers: ["U1"],
    allowGuests: false,
    instructions: "Be brief.",
    setup: "pnpm install",
  };
  const clientWith = (bot: SavedBot | null) =>
    ({ runs: {}, bots: { self: async () => bot } }) as unknown as GittermClient;

  test("fills in the saved settings and keeps what is set locally", async () => {
    const options = await withSavedConfig(
      { gitterm: clientWith(saved), model: { id: saved.model, apiKey: "inline" } },
      "slack",
      quietLog,
    );
    expect(options).toMatchObject({
      repo: "https://github.com/acme/app#main",
      model: { id: saved.model, apiKey: "inline" },
      connections: ["Linear"],
      workspace: { provider: { type: "e2b" } },
      allowedUsers: ["U1"],
      instructions: "Be brief.",
      setup: ["pnpm install"],
    });
  });

  test("answers only in the picked channels", async () => {
    const options = await withSavedConfig(
      { gitterm: clientWith({ ...saved, channels: ["C1", "C2"] }) },
      "slack",
      quietLog,
    );
    expect(options.repo).toBeUndefined();
    expect(options.channels).toEqual({ C1: saved.repo, C2: saved.repo });
  });

  test("a repository override cannot discard saved authorization", async () => {
    const options = await withSavedConfig(
      {
        gitterm: clientWith({ ...saved, channels: ["C1"] }),
        repo: saved.repo,
        allowedUsers: ["U1", "U2"],
        allowGuests: true,
      },
      "slack",
      quietLog,
    );
    expect(options.allowedChannels).toEqual(["C1"]);
    expect(options.allowedUsers).toEqual(["U1"]);
    expect(options.allowGuests).toBe(false);
  });

  test("configuration fetch failures abort startup rather than falling back to local policy", async () => {
    const client = {
      runs: {},
      bots: {
        self: async () => {
          throw new Error("offline");
        },
      },
    } as unknown as GittermClient;
    await expect(
      withSavedConfig({ gitterm: client, repo: saved.repo }, "slack", quietLog),
    ).rejects.toThrow("offline");
  });

  test("local overrides may narrow, never broaden, saved capabilities", async () => {
    await expect(
      withSavedConfig(
        { gitterm: clientWith(saved), repo: "https://github.com/acme/private" },
        "slack",
        quietLog,
      ),
    ).rejects.toThrow("saved bot policy");
    const options = await withSavedConfig(
      { gitterm: clientWith(saved), allowedUsers: ["U9"], connections: [] },
      "slack",
      quietLog,
    );
    expect(options.allowedUsers).toEqual([]);
    expect(options.connections).toEqual([]);
  });

  test("leaves options alone without saved settings, and refuses another platform's bot", async () => {
    const options = { gitterm: clientWith(null), repo: "https://github.com/acme/web" };
    expect(await withSavedConfig(options, "slack", quietLog)).toEqual(options);
    await expect(
      withSavedConfig({ gitterm: clientWith(saved) }, "discord", quietLog),
    ).rejects.toThrow('belongs to the slack bot "Acme agent"');
  });
});
