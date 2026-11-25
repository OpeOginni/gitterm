import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GittermPlugin, type GittermPluginOptions } from "./index";
import { checkoutRoot, git } from "@gitterm/move/checkout/snapshot";
import { saveRecord, type MoveRecord } from "@gitterm/move/records";

let root: string;
let home: string;
const saved = {
  HOME: process.env.HOME,
  GITTERM_API_TOKEN: process.env.GITTERM_API_TOKEN,
  GITTERM_SANDBOX_CONFIG: process.env.GITTERM_SANDBOX_CONFIG,
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gitterm-plugin-test-"));
  await git(root, ["init", "-b", "main"]);
  root = await checkoutRoot(root);
  // Signed out, and move records in this HOME: nothing of whoever runs the tests is seen.
  home = await mkdtemp(path.join(tmpdir(), "gitterm-plugin-home-"));
  process.env.HOME = home;
  delete process.env.GITTERM_API_TOKEN;
  delete process.env.GITTERM_SANDBOX_CONFIG;
});
afterEach(async () => {
  process.env.HOME = saved.HOME;
  if (saved.GITTERM_API_TOKEN !== undefined)
    process.env.GITTERM_API_TOKEN = saved.GITTERM_API_TOKEN;
  if (saved.GITTERM_SANDBOX_CONFIG !== undefined)
    process.env.GITTERM_SANDBOX_CONFIG = saved.GITTERM_SANDBOX_CONFIG;
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

type Context = Parameters<typeof GittermPlugin.setup>[0];
type Transform = Context["command"]["transform"];
type ToolTransform = Context["tool"]["transform"];

/** Sets the plugin up over GitTerm's move records; returns the commands, hooks and tools it adds. */
async function setup(options: GittermPluginOptions = {}) {
  const commands: string[] = [];
  const hooks: string[] = [];
  const rpc: string[] = [];
  const tools: string[] = [];
  const context = {
    options,
    location: { directory: root },
    command: {
      transform: async (transform: Parameters<Transform>[0]) => {
        transform({
          add: (definition) => {
            commands.push(definition.name);
          },
        } as Parameters<Parameters<Transform>[0]>[0]);
      },
    },
    session: {
      hook: async (name: string) => {
        hooks.push(name);
      },
    },
    rpc: {
      register: async (definition: { id: string; methods: object }) => {
        rpc.push(`${definition.id}: ${Object.keys(definition.methods).join(", ")}`);
        return { events: { emit: async () => {} }, dispose: async () => {} };
      },
    },
    tool: {
      transform: async (transform: Parameters<ToolTransform>[0]) => {
        transform({
          namespace: () => {},
          add: (definition: { name: string }) => {
            tools.push(definition.name);
          },
        } as unknown as Parameters<Parameters<ToolTransform>[0]>[0]);
      },
    },
  } as unknown as Context;
  const cleanup = await GittermPlugin.setup(context);
  if (cleanup) await cleanup();
  return { commands, hooks, rpc, tools };
}

/** A move recorded by @gitterm/move, from /cloud or from the CLI alike. */
const moved = (changes: Partial<MoveRecord>) =>
  saveRecord({
    workspaceId: "workspace-test",
    agent: "opencode",
    localRef: "ses_test",
    localMark: 0,
    localCwd: root,
    root,
    head: "0".repeat(40),
    state: "state",
    cloudRef: "ses_test",
    cloudCwd: "/w",
    cloudDirectory: "/w",
    movedAt: "2026-01-01T00:00:00.000Z",
    ...changes,
  });

test("signed out, no sandbox account: /cloud (it signs in), its hooks and channel, no tools", async () => {
  expect(await setup()).toEqual({
    commands: ["cloud"],
    hooks: ["prompt", "fork"],
    rpc: ["gitterm.cloud: cancel"],
    tools: [],
  });
});

const SANDBOX_TOOLS = ["sandbox_create", "sandbox_list", "sandbox_sync", "sandbox_exec"];

test("a provider key and no GitTerm login: sandbox tools, and no /cloud", async () => {
  const result = await setup({
    sandbox: { provider: "e2b", apiKey: "{env:GITTERM_TEST_UNSET_KEY}" },
  });
  expect(result.tools).toEqual(expect.arrayContaining(SANDBOX_TOOLS));
  expect(result.commands).toEqual([]);
  expect(result.hooks).toEqual([]);
});

test("signed in to GitTerm: sandbox tools through that account, and /cloud", async () => {
  // A server that refuses at once: nothing here needs it to answer.
  const result = await setup({ serverUrl: "http://127.0.0.1:9", token: "test-token" });
  expect(result.tools).toEqual(expect.arrayContaining(SANDBOX_TOOLS));
  expect(result.commands).toEqual(["cloud"]);
});

test("offers /cloud-return only while a session of this checkout is in the cloud", async () => {
  // A session that came back, one of another checkout, and one of another agent do not count.
  await moved({ workspaceId: "w-back", returnedAt: "2026-01-02T00:00:00.000Z" });
  await moved({ workspaceId: "w-other", root: "/another/checkout" });
  await moved({ workspaceId: "w-pi", agent: "pi" });
  expect((await setup()).commands).toEqual(["cloud"]);
  await moved({ workspaceId: "w-1" });
  expect((await setup()).commands).toEqual(["cloud", "cloud-return"]);
});

test("a project turned off on this machine gets no sandbox tools and no /cloud", async () => {
  await mkdir(path.join(home, ".config", "gitterm"), { recursive: true });
  await writeFile(
    path.join(home, ".config", "gitterm", "projects.json"),
    JSON.stringify({ [root]: { sandbox: false, cloud: false } }),
  );
  const result = await setup([], { serverUrl: "http://127.0.0.1:9", token: "test-token" });
  expect(result.tools).toEqual([]);
  expect(result.commands).toEqual([]);
});

test("the gitterm CLI's sandbox settings count when the plugin has no sandbox option", async () => {
  await mkdir(path.join(home, ".config", "gitterm"), { recursive: true });
  await writeFile(
    path.join(home, ".config", "gitterm", "sandbox.json"),
    JSON.stringify({ provider: "e2b", apiKey: "{env:GITTERM_TEST_UNSET_KEY}" }),
  );
  const result = await setup([]);
  expect(result.tools).toEqual(expect.arrayContaining(SANDBOX_TOOLS));
  // A provider key and no GitTerm login: nothing to move a session with.
  expect(result.commands).toEqual([]);
});

test("the options can turn each part off, as a project's own opencode.json does", async () => {
  const signedIn = { serverUrl: "http://127.0.0.1:9", token: "test-token" };
  const noSandbox = await setup([], { ...signedIn, sandbox: false });
  expect(noSandbox.tools).toEqual([]);
  expect(noSandbox.commands).toEqual(["cloud"]);
  const noCloud = await setup([], { ...signedIn, cloud: false });
  expect(noCloud.tools).toEqual(expect.arrayContaining(SANDBOX_TOOLS));
  expect(noCloud.commands).toEqual([]);
});
