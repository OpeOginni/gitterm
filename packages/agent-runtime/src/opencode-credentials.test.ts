import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENCODE_CREDENTIALS_PATH,
  OPENCODE_CREDENTIALS_PLUGIN_PATH,
  opencodeCredentialFiles,
  type OpencodeCredentialEntry,
} from "./opencode-credentials";

const auth: OpencodeCredentialEntry[] = [
  {
    integration: "anthropic",
    label: "work",
    active: true,
    value: { type: "api", key: "sk-ant-work" },
  },
  { integration: "anthropic", label: "personal", value: { type: "api", key: "sk-ant-home" } },
  {
    integration: "github-copilot",
    label: "GitHub",
    value: { type: "oauth", refresh: "gh-refresh", access: "gh-access", expires: 1 },
  },
  {
    integration: "openai/",
    label: "ChatGPT",
    value: { type: "oauth", refresh: "oa-refresh", accountId: "acct" },
  },
  { integration: "unknown", label: "x", value: { type: "api", key: "nope" } },
];

test("ships the credentials JSON plus the importer plugin", () => {
  const files = opencodeCredentialFiles(auth);
  expect(files.map((file) => file.path)).toEqual([
    OPENCODE_CREDENTIALS_PATH,
    OPENCODE_CREDENTIALS_PLUGIN_PATH,
  ]);
  expect(files[0]).toMatchObject({ mode: 0o600 });
  expect(JSON.parse(Buffer.from(files[0]!.contentBase64, "base64").toString())).toEqual(auth);
});

const homes: string[] = [];
const originalHome = process.env.HOME;
afterEach(() => {
  process.env.HOME = originalHome;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** Writes the files into a fake home and loads the plugin exactly as OpenCode would. */
async function loadPlugin(entries: OpencodeCredentialEntry[]) {
  const home = mkdtempSync(join(tmpdir(), "gitterm-opencode-credentials-"));
  homes.push(home);
  process.env.HOME = home;
  for (const file of opencodeCredentialFiles(entries)) {
    const target = join(home, file.path.slice(2));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, Buffer.from(file.contentBase64, "base64"), { mode: file.mode });
  }
  const mod = await import(
    `${join(home, OPENCODE_CREDENTIALS_PLUGIN_PATH.slice(2))}?${Date.now()}`
  );
  return mod.default as { id: string; setup(ctx: unknown): Promise<void> };
}

type Method = { type: string; id?: string };
type Connection = { type: "credential"; id: string; label: string };
type Registration = {
  integrationID: string;
  method: Method;
  authorize(): Promise<{ callback: Promise<Record<string, unknown>> }>;
};

/** Minimal stand-in for the OpenCode plugin context, recording what the plugin does. */
function fakeContext(input: {
  integrations: Record<string, { methods: Method[]; connections?: Connection[] }>;
}) {
  const state = structuredClone(input.integrations) as Record<
    string,
    { methods: Method[]; connections: Connection[] }
  >;
  for (const entry of Object.values(state)) entry.connections ??= [];
  const registrations: Registration[] = [];
  const stored: Array<{ integrationID: string; label: string; value: Record<string, unknown> }> =
    [];
  const attempts = new Map<string, Promise<void>>();
  let sequence = 0;
  const ctx = {
    integration: {
      transform: async (edit: (editor: unknown) => void) => {
        edit({
          get: (id: string) => (state[id] ? { id, name: id } : undefined),
          method: {
            list: (id: string) => state[id]?.methods ?? [],
            update: (registration: Registration) => {
              registrations.push(registration);
              state[registration.integrationID]!.methods.push(registration.method);
            },
          },
        });
      },
      get: async ({ integrationID }: { integrationID: string }) => {
        if (!state[integrationID]) throw new Error("not found");
        return { data: { id: integrationID, ...state[integrationID] } };
      },
      connect: {
        key: async ({
          integrationID,
          key,
          label,
        }: {
          integrationID: string;
          key: string;
          label: string;
        }) => {
          stored.push({ integrationID, label, value: { type: "key", key } });
          state[integrationID]!.connections.push({
            type: "credential",
            id: `cred_${++sequence}`,
            label,
          });
          return { data: undefined };
        },
      },
      oauth: {
        connect: async ({
          integrationID,
          methodID,
          label,
        }: {
          integrationID: string;
          methodID: string;
          label: string;
        }) => {
          const registration = registrations.find(
            (candidate) =>
              candidate.integrationID === integrationID && candidate.method.id === methodID,
          )!;
          const attemptID = `attempt_${++sequence}`;
          attempts.set(
            attemptID,
            registration
              .authorize()
              .then((authorization) => authorization.callback)
              .then((value) => {
                stored.push({ integrationID, label, value });
                state[integrationID]!.connections.push({
                  type: "credential",
                  id: `cred_${++sequence}`,
                  label,
                });
              }),
          );
          return { data: { attemptID } };
        },
        status: async ({ attemptID }: { attemptID: string }) => {
          await attempts.get(attemptID);
          return { data: { status: "complete" } };
        },
      },
    },
  };
  return { ctx, stored, state };
}

test("plugin imports every account with its label and creates the active one last", async () => {
  const plugin = await loadPlugin(auth);
  const { ctx, stored } = fakeContext({
    integrations: {
      anthropic: { methods: [{ type: "key" }] },
      "github-copilot": { methods: [{ type: "oauth", id: "device" }] },
      openai: {
        methods: [
          { type: "oauth", id: "chatgpt-browser" },
          { type: "oauth", id: "api" },
        ],
      },
    },
  });
  expect(plugin.id).toBe("gitterm-credentials");
  await plugin.setup(ctx);
  expect(stored).toEqual([
    { integrationID: "anthropic", label: "personal", value: { type: "key", key: "sk-ant-home" } },
    { integrationID: "anthropic", label: "work", value: { type: "key", key: "sk-ant-work" } },
    {
      integrationID: "github-copilot",
      label: "GitHub",
      value: {
        type: "oauth",
        methodID: "device",
        refresh: "gh-refresh",
        access: "gh-access",
        expires: 1,
      },
    },
    {
      integrationID: "openai",
      label: "ChatGPT",
      value: {
        type: "oauth",
        methodID: "chatgpt-browser",
        refresh: "oa-refresh",
        access: "",
        expires: 0,
        metadata: { accountID: "acct" },
      },
    },
  ]);
});

test("plugin skips accounts whose label already exists on the integration", async () => {
  const plugin = await loadPlugin([
    { integration: "anthropic", label: "work", value: { type: "api", key: "sk-ant-work" } },
    { integration: "anthropic", label: "new", value: { type: "api", key: "sk-ant-new" } },
  ]);
  const { ctx, stored } = fakeContext({
    integrations: {
      anthropic: {
        methods: [{ type: "key" }],
        connections: [{ type: "credential", id: "cred_existing", label: "work" }],
      },
    },
  });
  await plugin.setup(ctx);
  expect(stored).toEqual([
    { integrationID: "anthropic", label: "new", value: { type: "key", key: "sk-ant-new" } },
  ]);
});

test("plugin tolerates a missing credentials file", async () => {
  const plugin = await loadPlugin([]);
  rmSync(join(process.env.HOME!, OPENCODE_CREDENTIALS_PATH.slice(2)));
  const { ctx, stored } = fakeContext({ integrations: {} });
  await plugin.setup(ctx);
  expect(stored).toEqual([]);
});
