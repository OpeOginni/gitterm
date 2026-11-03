import { expect, mock, test } from "bun:test";

const created: { publicPreviews?: boolean }[] = [];
const actual = await import("@gitterm/sdk/sandbox");
mock.module("@gitterm/sdk/sandbox", () => ({
  ...actual,
  createSandboxBackend: () => ({}),
  createSandboxClient: () => ({
    identity: { mode: "direct", account: "e2b", provider: "e2b" },
    limits: { defaultLifetimeMinutes: 30, maxSandboxes: 2 },
    list: async () => [],
    create: async (input: { publicPreviews?: boolean }) => {
      created.push(input);
      return {
        id: "sbx",
        name: "s",
        state: "running",
        mode: "direct",
        account: "e2b",
        provider: "e2b",
        sessionId: "ses",
        createdAt: new Date().toISOString(),
        expiresAt: null,
        snapshot: null,
        jobs: {},
        previews: {},
      };
    },
  }),
}));
const { registerSandboxTools } = await import("./sandbox");

async function createSandbox(options: Record<string, unknown>, input: Record<string, unknown>) {
  const asked: string[] = [];
  let create: ((input: unknown, context: unknown) => Promise<unknown>) | undefined;
  const ctx = {
    tool: {
      transform: async (transform: (editor: unknown) => void) =>
        transform({
          namespace: () => {},
          add: (tool: { name: string; execute: typeof create }) => {
            if (tool.name === "sandbox_create") create = tool.execute;
          },
        }),
    },
    session: { get: async () => ({ location: { directory: process.cwd() } }) },
    permission: { assert: async (request: { action: string }) => asked.push(request.action) },
  };
  const settings = {
    account: "e2b",
    accounts: { e2b: { mode: "direct", provider: "e2b", apiKey: "k" } },
    ...options,
  };
  await registerSandboxTools(ctx as never, settings as never);
  created.length = 0;
  await create!(input, { sessionID: "ses", agent: "a", messageID: "m", id: "t" });
  return { asked, publicPreviews: created[0]?.publicPreviews };
}

test("publicPreviews in the options makes every sandbox public without asking", async () => {
  expect(await createSandbox({ publicPreviews: true }, {})).toEqual({
    asked: ["gitterm.sandbox.provision"],
    publicPreviews: true,
  });
});

test("without the option, previews are private unless the agent asks and you approve", async () => {
  expect(await createSandbox({}, {})).toEqual({
    asked: ["gitterm.sandbox.provision"],
    publicPreviews: false,
  });
  expect(await createSandbox({}, { publicPreviews: true })).toEqual({
    asked: ["gitterm.sandbox.provision", "gitterm.sandbox.public"],
    publicPreviews: true,
  });
});
