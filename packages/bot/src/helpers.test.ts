import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentQuestion, ModelCredential } from "@gitterm/sdk";
import { botOptionsFromEnv } from "./env.js";
import { splitMessage, tablesToCode } from "./markdown.js";
import { buildPrompt, interpretPermissionReply, interpretTypedAnswer } from "./prompt.js";
import type { ChatFile } from "./types.js";
import { modelsFor, parseRepo, repoLabel } from "./workspaces.js";

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
