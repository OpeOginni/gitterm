import { expect, test } from "bun:test";
import type { GittermClient, Workspace } from "@gitterm/sdk";
import { createWorkspaceManager, parseRepo } from "./workspaces.js";
const repo = parseRepo("https://github.com/acme/app");
const quiet = { info() {}, warn() {}, error() {} };
function fixture() {
  const rows: Workspace[] = [];
  const client = {
    workspaces: {
      list: async ({ metadata }: { metadata: Record<string, string> }) => ({
        workspaces: rows.filter(
          (row) =>
            row.status !== "terminated" &&
            Object.entries(metadata).every(([key, value]) => row.metadata[key] === value),
        ),
      }),
      create: async (input: Record<string, unknown>) => {
        const workspace = {
          id: `ws${rows.length + 1}`,
          status: "running",
          metadata: input.metadata,
        } as Workspace;
        rows.push(workspace);
        return { workspace };
      },
      ensureRunning: async (id: string) => ({ workspace: rows.find((row) => row.id === id)! }),
      terminate: async (id: string) => {
        rows.find((row) => row.id === id)!.status = "terminated";
      },
    },
    integrations: {
      connections: {
        resolve: async (refs: string[]) => {
          if (refs.includes("github")) throw new Error("No GitHub connection");
          return refs.map((id) => ({
            id,
            details: { url: `https://tools.test/${id}`, revision: 1 },
          }));
        },
      },
    },
    credentials: { list: async () => [] },
  } as unknown as GittermClient;
  const base = {
    gitterm: client,
    platform: "slack",
    scope: "T1",
    botId: "bot-a",
    connections: [],
    env: {},
    setup: [],
    model: undefined,
    instructions: "instructions",
    overrides: undefined,
    log: quiet,
  };
  return { rows, base };
}
test("bots cannot adopt each other's credential-bearing sandbox", async () => {
  const { base } = fixture();
  const privileged = await createWorkspaceManager({ ...base, connections: ["Production"] }).ensure(
    repo,
    () => {},
    "channel:C1",
  );
  const other = await createWorkspaceManager({ ...base, botId: "bot-b" }).ensure(
    repo,
    () => {},
    "channel:C1",
  );
  expect(privileged.id).not.toBe(other.id);
});
test("changed sandbox capabilities require explicit replacement; restarts reuse identical settings", async () => {
  const { base, rows } = fixture();
  const first = await createWorkspaceManager({ ...base, connections: ["Production"] }).ensure(
    repo,
    () => {},
  );
  const same = await createWorkspaceManager({ ...base, connections: ["Production"] }).ensure(
    repo,
    () => {},
  );
  expect(first.id).toBe(same.id);
  const narrowed = createWorkspaceManager(base);
  await expect(narrowed.ensure(repo, () => {})).rejects.toThrow("Sandbox settings changed");
  expect(rows[0]!.status).toBe("running");
  await narrowed.reset(repo);
  const next = await narrowed.ensure(repo, () => {});
  expect(next.id).not.toBe(first.id);
});
