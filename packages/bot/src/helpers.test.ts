import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentQuestion, Connection } from "@gitterm/sdk";
import { botOptionsFromEnv } from "./env.js";
import { splitMessage, tablesToCode } from "./markdown.js";
import { buildPrompt, interpretPermissionReply, interpretTypedAnswer } from "./prompt.js";
import type { ChatFile } from "./types.js";
import { parseRepo, pickConnections, repoLabel } from "./workspaces.js";

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

describe("pickConnections", () => {
  const connection = (patch: Partial<Connection> & Record<string, unknown>) =>
    ({ kind: "personal", status: "connected", connectedAt: "", name: "x", ...patch }) as Connection;
  const ownGithub = connection({
    id: "gh-acme",
    integration: "github",
    details: { integration: "github", mode: "app", accountLogin: "acme" },
  });
  const otherGithub = connection({
    id: "gh-other",
    integration: "github",
    details: { integration: "github", mode: "app", accountLogin: "other" },
  });
  const shared = connection({
    id: "github:shared",
    integration: "github",
    kind: "shared",
    details: { integration: "github", mode: "pat", accountLogin: "bot" },
  });
  const executor = connection({ id: "ex1", integration: "executor", name: "Executor" } as never);
  const repo = parseRepo("https://github.com/acme/app");

  test("auto picks the owner's GitHub connection and every MCP source", () => {
    expect(pickConnections([otherGithub, ownGithub, shared, executor], repo, "auto")).toEqual([
      "gh-acme",
      "ex1",
    ]);
  });

  test("auto falls back to the shared GitHub connection, never another owner's", () => {
    expect(pickConnections([otherGithub, shared], repo, "auto")).toEqual(["github:shared"]);
    expect(pickConnections([otherGithub], repo, "auto")).toEqual([]);
  });

  test("explicit choices match ids or names and must be connected", () => {
    expect(pickConnections([executor], repo, ["executor"])).toEqual(["ex1"]);
    expect(() =>
      pickConnections([{ ...executor, status: "error" } as Connection], repo, ["ex1"]),
    ).toThrow("not connected");
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
        GITTERM_BOT_CONNECTIONS: "none",
        GITTERM_BOT_PROVIDER: "railway",
        GITTERM_BOT_RUN_TIMEOUT_MINUTES: "20",
      }),
    ).toEqual({
      repo: "https://github.com/acme/app",
      channels: { C1: "https://github.com/acme/api#main", C2: "https://github.com/acme/web" },
      connections: [],
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
