import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GittermCloudPlugin } from "./index";
import { checkoutRoot, git } from "@gitterm/move/checkout/snapshot";
import { saveRecord, type MoveRecord } from "@gitterm/move/records";

let root: string;
const home = process.env.HOME;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gitterm-plugin-test-"));
  await git(root, ["init", "-b", "main"]);
  root = await checkoutRoot(root);
  // Move records go to this HOME, not the user's.
  process.env.HOME = path.join(root, ".home");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  process.env.HOME = home;
});

type Context = Parameters<typeof GittermCloudPlugin.setup>[0];
type Transform = Context["command"]["transform"];

/** Sets the plugin up over GitTerm's move records and returns what it registers. */
async function setup() {
  const commands: string[] = [];
  const hooks: string[] = [];
  const rpc: string[] = [];
  const context = {
    options: {},
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
      transform: async () => {
        throw new Error("The handoff plugin must not register tools");
      },
    },
  } as unknown as Context;
  const cleanup = await GittermCloudPlugin.setup(context);
  if (cleanup) await cleanup();
  return { commands, hooks, rpc };
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

test("registers /cloud, the prompt check, the fork cleanup and the terminal channel, and no tools", async () => {
  expect(await setup()).toEqual({
    commands: ["cloud"],
    hooks: ["prompt", "fork"],
    rpc: ["gitterm.cloud: cancel"],
  });
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
