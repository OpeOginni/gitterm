import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HandoffRecord } from "./handoff";
import { GittermCloudPlugin } from "./index";
import { checkoutRoot, git } from "./snapshot";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gitterm-plugin-test-"));
  await git(root, ["init", "-b", "main"]);
  root = await checkoutRoot(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Context = Parameters<typeof GittermCloudPlugin.setup>[0];
type Transform = Context["command"]["transform"];

/** Sets the plugin up over `stored` records and returns the commands and hooks it registers. */
async function setup(stored: HandoffRecord[]) {
  const commands: string[] = [];
  const hooks: string[] = [];
  const rpc: string[] = [];
  const context = {
    options: {},
    location: { directory: root },
    storage: {
      scan: async () => ({
        entries: stored.map((value) => ({ key: `handoff/session/${value.sessionID}`, value })),
      }),
    },
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
      transform: async () => {
        throw new Error("The handoff plugin must not register tools");
      },
    },
  } as unknown as Context;
  const cleanup = await GittermCloudPlugin.setup(context);
  if (cleanup) await cleanup();
  return { commands, hooks, rpc };
}

const record = (phase: HandoffRecord["phase"], sourceDirectory: string): HandoffRecord => ({
  attemptID: "1111-aaaa",
  sessionID: "ses_test",
  phase,
  workspaceID: "workspace-test",
  sourceDirectory,
  head: "0".repeat(40),
  includeChanges: true,
  createdAt: "2026-01-01T00:00:00.000Z",
});

test("registers /cloud, the prompt check, the fork cleanup and the terminal channel, and no tools", async () => {
  expect(await setup([])).toEqual({
    commands: ["cloud"],
    hooks: ["prompt", "fork"],
    rpc: ["gitterm.cloud: cancel"],
  });
});

test("offers /cloud-return only while a session of this checkout is in the cloud", async () => {
  expect((await setup([record("ready", root)])).commands).toEqual(["cloud", "cloud-return"]);
  // A session that came back, and one that belongs to another checkout, do not count.
  expect((await setup([record("returned", root)])).commands).toEqual(["cloud"]);
  expect((await setup([record("ready", "/another/checkout")])).commands).toEqual(["cloud"]);
});
