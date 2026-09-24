import { afterEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENCODE_CREDENTIALS_PATH,
  OPENCODE_CREDENTIALS_PLUGIN_PATH,
  OPENCODE_MANAGED_REFRESH,
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
const originalFetch = globalThis.fetch;
afterEach(() => {
  process.env.HOME = originalHome;
  globalThis.fetch = originalFetch;
  delete process.env.WORKSPACE_API_URL;
  delete process.env.WORKSPACE_AGENT_AUTH_TOKEN;
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

type Method = { type: string; id?: string; form?: Array<{ key: string }> };
type Connection = { type: "credential"; id: string; label: string };
type Registration = {
  integrationID: string;
  method: Method;
  authorize(): Promise<{ callback: Promise<Record<string, unknown>> }>;
  refresh?(credential: Record<string, unknown>): Promise<Record<string, unknown>>;
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
          answer,
        }: {
          integrationID: string;
          key: string;
          label: string;
          answer?: Record<string, string>;
        }) => {
          if (integrationID === "broken") throw new Error("rejected");
          stored.push({
            integrationID,
            label,
            value: { type: "key", key, ...(answer ? { metadata: answer } : {}) },
          });
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
  return { ctx, stored, state, registrations };
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

test("plugin answers only the key form fields OpenCode asks for", async () => {
  const plugin = await loadPlugin([
    {
      integration: "cloudflare-ai-gateway",
      label: "gateway",
      value: { type: "api", key: "cf-token", metadata: { accountId: "acct", gatewayId: "gw" } },
    },
    {
      integration: "cloudflare-workers-ai",
      label: "workers",
      value: { type: "api", key: "cf-key", metadata: { accountId: "acct" } },
    },
  ]);
  const { ctx, stored } = fakeContext({
    integrations: {
      // CLOUDFLARE_ACCOUNT_ID is set, so the gateway form only asks for the gateway.
      "cloudflare-ai-gateway": { methods: [{ type: "key", form: [{ key: "gatewayId" }] }] },
      // No form at all: OpenCode would reject any answer.
      "cloudflare-workers-ai": { methods: [{ type: "key" }] },
    },
  });
  await plugin.setup(ctx);
  expect(stored).toEqual([
    {
      integrationID: "cloudflare-ai-gateway",
      label: "gateway",
      value: { type: "key", key: "cf-token", metadata: { gatewayId: "gw" } },
    },
    {
      integrationID: "cloudflare-workers-ai",
      label: "workers",
      value: { type: "key", key: "cf-key" },
    },
  ]);
});

test("plugin keeps OAuth metadata such as the OpenCode console organization", async () => {
  const plugin = await loadPlugin([
    {
      integration: "opencode",
      label: "Acme",
      value: {
        type: "oauth",
        refresh: "oc-refresh",
        access: "oc-access",
        expires: 5,
        metadata: { server: "https://opencode.ai/console", orgID: "org_1", orgName: "Acme" },
      },
    },
  ]);
  const { ctx, stored } = fakeContext({
    integrations: {
      opencode: { methods: [{ type: "oauth", id: "device" }, { type: "key" }] },
    },
  });
  await plugin.setup(ctx);
  expect(stored).toEqual([
    {
      integrationID: "opencode",
      label: "Acme",
      value: {
        type: "oauth",
        methodID: "device",
        refresh: "oc-refresh",
        access: "oc-access",
        expires: 5,
        metadata: { server: "https://opencode.ai/console", orgID: "org_1", orgName: "Acme" },
      },
    },
  ]);
});

test("plugin keeps importing after one credential is rejected", async () => {
  const plugin = await loadPlugin([
    { integration: "broken", label: "x", value: { type: "api", key: "bad" } },
    { integration: "anthropic", label: "work", value: { type: "api", key: "sk-ant-work" } },
  ]);
  const { ctx, stored } = fakeContext({
    integrations: {
      broken: { methods: [{ type: "key" }] },
      anthropic: { methods: [{ type: "key" }] },
    },
  });
  await plugin.setup(ctx);
  expect(stored).toEqual([
    { integrationID: "anthropic", label: "work", value: { type: "key", key: "sk-ant-work" } },
  ]);
});

test("GitTerm-managed accounts refresh through the GitTerm API, never a local refresh token", async () => {
  const plugin = await loadPlugin([
    {
      integration: "opencode",
      label: "Acme",
      value: {
        type: "oauth",
        refresh: OPENCODE_MANAGED_REFRESH,
        access: "old",
        expires: 1,
        metadata: { orgID: "org_1", gittermCredentialId: "cred-1" },
      },
    },
    {
      integration: "openai",
      label: "ChatGPT",
      value: {
        type: "oauth",
        refresh: OPENCODE_MANAGED_REFRESH,
        access: "old",
        expires: 1,
        accountId: "acct",
        metadata: { gittermCredentialId: "cred-2" },
      },
    },
  ]);
  const { ctx, stored, registrations } = fakeContext({
    integrations: {
      opencode: { methods: [{ type: "oauth", id: "device" }] },
      openai: { methods: [{ type: "oauth", id: "chatgpt-browser" }] },
    },
  });
  await plugin.setup(ctx);

  expect(stored.map((entry) => [entry.integrationID, entry.value.methodID])).toEqual([
    ["opencode", "gitterm-import"],
    ["openai", "chatgpt-browser"],
  ]);
  expect(stored.every((entry) => entry.value.refresh === OPENCODE_MANAGED_REFRESH)).toBe(true);
  // ChatGPT routing needs the built-in method ID, so the plugin takes that method over.
  const override = registrations.find(
    (registration) =>
      registration.integrationID === "openai" && registration.method.id === "chatgpt-browser",
  );
  expect(override?.refresh).toBeDefined();

  process.env.WORKSPACE_API_URL = "https://api.test/trpc/";
  process.env.WORKSPACE_AGENT_AUTH_TOKEN = "agent-token";
  const fetchMock = mock(async (_url: string, _init: RequestInit) =>
    Response.json({
      result: { data: { access: "new", expires: 99, metadata: { orgID: "org_2" } } },
    }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const credential = stored[0]!.value;
  const [first, second] = await Promise.all([
    override!.refresh!(stored[1]!.value),
    registrations.find((registration) => registration.integrationID === "opencode")!.refresh!(
      credential,
    ),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [url, init] = fetchMock.mock.calls[1]!;
  expect(url).toBe("https://api.test/trpc/workspaceOps.modelCredential");
  expect(init.headers).toMatchObject({ Authorization: "Bearer agent-token" });
  expect(JSON.parse(String(init.body))).toEqual({ credentialId: "cred-1" });
  expect(first).toMatchObject({ access: "new", expires: 99, methodID: "chatgpt-browser" });
  expect(second).toMatchObject({
    access: "new",
    refresh: OPENCODE_MANAGED_REFRESH,
    metadata: { orgID: "org_2", gittermCredentialId: "cred-1" },
  });
});
