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
  const run: Record<string, (input: { sessionID: string }) => Promise<void>> = {};
  const hooks: string[] = [];
  const rpc: string[] = [];
  const context = {
    // Nothing reaches an OpenCode server: this port is closed.
    options: { localServerUrl: "http://127.0.0.1:9" },
    location: { directory: root },
    command: {
      transform: async (transform: Parameters<Transform>[0]) => {
        transform({
          add: (definition) => {
            commands.push(definition.name);
            run[definition.name] = definition.execute as (typeof run)[string];
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
  return { commands, hooks, rpc, run };
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

test("registers /cloud, /cloud-return, the prompt check, the fork cleanup and the terminal channel, and no tools", async () => {
  expect(await setup()).toMatchObject({
    commands: ["cloud", "cloud-return"],
    hooks: ["prompt", "fork"],
    rpc: ["gitterm.cloud: cancel"],
  });
});

test("/cloud-return finds a move made after the plugin started, from the CLI too", async () => {
  const { run } = await setup();
  await expect(run["cloud-return"]!({ sessionID: "ses_test" })).rejects.toThrow(
    "not in a cloud workspace",
  );
  // A session that came back, one of another agent: nothing to return.
  await moved({ workspaceId: "w-back", returnedAt: "2026-01-02T00:00:00.000Z" });
  await moved({ workspaceId: "w-pi", agent: "pi" });
  await expect(run["cloud-return"]!({ sessionID: "ses_test" })).rejects.toThrow(
    "not in a cloud workspace",
  );
  // Moved now: the return goes on, to the (closed) OpenCode server.
  await moved({ workspaceId: "w-1" });
  const error = await run["cloud-return"]!({ sessionID: "ses_test" }).catch((e: Error) => e);
  expect(String(error)).not.toContain("not in a cloud workspace");
});
