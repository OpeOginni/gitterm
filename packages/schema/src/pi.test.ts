import { afterAll, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PI_EXTENSION } from "./pi";

// The extension's imports from Pi, which only Pi provides.
mock.module("@earendil-works/pi-ai", () => ({ StringEnum: (values: unknown) => values }));
mock.module("typebox", () => ({
  Type: new Proxy({}, { get: () => (value: unknown) => value ?? {} }),
}));

const root = mkdtempSync(path.join(tmpdir(), "gitterm-pi-ext-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Exec = { stdout: string; stderr: string; code: number };
type Tool = { execute: (...args: unknown[]) => Promise<unknown> };

/**
 * Loads the extension with `PATH` as given and a fake Pi whose `exec` answers with `respond`.
 * Returns its tools and every command it ran.
 */
async function load(name: string, pathEnv: string, respond: (args: string[]) => Exec) {
  const saved = {
    path: process.env.PATH,
    home: process.env.HOME,
    token: process.env.GITTERM_API_TOKEN,
  };
  process.env.PATH = pathEnv;
  process.env.HOME = path.join(root, "home");
  process.env.GITTERM_API_TOKEN = "gt_test";
  const file = path.join(root, `${name}.ts`);
  writeFileSync(file, PI_EXTENSION);
  const calls: string[][] = [];
  const tools: Record<string, Tool> = {};
  try {
    const { default: extension } = await import(file);
    extension({
      on: () => {},
      registerCommand: () => {},
      registerTool: (tool: Tool & { name: string }) => void (tools[tool.name] = tool),
      sendMessage: () => {},
      exec: async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        return respond(args);
      },
    });
  } finally {
    process.env.PATH = saved.path;
    process.env.HOME = saved.home;
    if (saved.token === undefined) delete process.env.GITTERM_API_TOKEN;
    else process.env.GITTERM_API_TOKEN = saved.token;
  }
  return { tools, calls };
}

const needsApproval = (question: string, always: boolean): Exec => ({
  stdout: "",
  stderr: JSON.stringify({
    error: { code: "NEEDS_APPROVAL", message: "Needs approval", question, always },
  }),
  code: 1,
});
const ok = (value: unknown): Exec => ({ stdout: JSON.stringify(value), stderr: "", code: 0 });
const record = { id: "sbx", name: "Pi sandbox", state: "running", account: "e2b", provider: "e2b" };
/** The CLI asks until a run carries --yes or --always. */
const cliAsks = (args: string[]) =>
  args.includes("--yes") || args.includes("--always")
    ? ok({ ...record, projectDir: "/work", snapshot: { id: "s" }, verified: true })
    : needsApproval("Create a billable sandbox charged to your E2B account?", true);
const ctx = (answer?: string) => ({
  cwd: root,
  hasUI: answer !== undefined,
  sessionManager: { getSessionId: () => "ses-1" },
  ui: {
    select: async (title: string, options: string[]) => (asked.push({ title, options }), answer),
  },
});
const asked: { title: string; options: string[] }[] = [];

test("Pi passes no approval flag the user did not give in Pi", async () => {
  const { tools, calls } = await load("no-ui", "/nonexistent", cliAsks);
  // No UI: the CLI's question comes back to the agent and nothing is created.
  await expect(tools.sandbox_create!.execute("1", {}, undefined, undefined, ctx())).rejects.toThrow(
    /cannot ask them/,
  );
  await expect(
    tools.sandbox_sync!.execute("2", { sandboxId: "sbx" }, undefined, undefined, ctx()),
  ).rejects.toThrow(/cannot ask them/);
  expect(calls.flat()).not.toContain("--yes");
  expect(calls.flat()).not.toContain("--always");
});

test("Pi asks the CLI's question and runs again with the answer", async () => {
  asked.length = 0;
  const { tools, calls } = await load("ui", "/nonexistent", cliAsks);
  await tools.sandbox_create!.execute("1", {}, undefined, undefined, ctx("Always in this project"));
  expect(asked).toEqual([
    {
      title: "Create a billable sandbox charged to your E2B account?",
      options: ["Yes", "Always in this project", "No"],
    },
  ]);
  expect(
    calls.map((call) => call.filter((arg) => arg.startsWith("--") && arg !== "--json")),
  ).toEqual([
    ["--dir", "--session", "--name"],
    ["--dir", "--session", "--name", "--always"],
  ]);
  // "No" runs nothing more.
  await expect(
    tools.sandbox_sync!.execute("2", { sandboxId: "sbx" }, undefined, undefined, ctx("No")),
  ).rejects.toThrow(/did not approve/);
  expect(calls).toHaveLength(3);
});

test("Pi runs gitterm from PATH, or through npx when setup ran from npx", async () => {
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "gitterm"), "#!/bin/sh\n");
  chmodSync(path.join(bin, "gitterm"), 0o755);
  const list = () => ok([]);
  const onPath = await load("on-path", bin, list);
  await onPath.tools.sandbox_pause!.execute("1", { sandboxId: "sbx" });
  expect(onPath.calls[0]!.slice(0, 3)).toEqual(["gitterm", "sandbox", "pause"]);
  const viaNpx = await load("via-npx", "/nonexistent", list);
  await viaNpx.tools.sandbox_pause!.execute("1", { sandboxId: "sbx" });
  expect(viaNpx.calls[0]!.slice(0, 5)).toEqual(["npx", "-y", "@gitterm/cli", "sandbox", "pause"]);
});

test("sandbox_create passes the agent's choice of public previews, false too", async () => {
  const { tools, calls } = await load("previews", "/nonexistent", () =>
    ok({ ...record, projectDir: "/work", snapshot: { id: "s" }, verified: true }),
  );
  const create = (params: Record<string, unknown>) =>
    tools.sandbox_create!.execute("1", params, undefined, undefined, ctx("Yes"));
  await create({ publicPreviews: false });
  await create({ publicPreviews: true });
  await create({});
  // An explicit false must reach the CLI: the saved default may be public.
  expect(calls.map((call) => call.filter((arg) => arg.endsWith("public")))).toEqual([
    ["--no-public"],
    ["--public"],
    [],
  ]);
});
