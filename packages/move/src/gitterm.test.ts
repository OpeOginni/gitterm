import { expect, test } from "bun:test";
import type { GittermClient, WorkspaceCatalog } from "@gitterm/sdk";
import { gittermCloud } from "./gitterm.js";

const provider = (id: string, type: string, agentKeys: string[], isDefault = false) =>
  ({ id, type, agentKeys, isDefault }) as WorkspaceCatalog["providers"][number];

/** A GitTerm client that only knows its providers and keeps what it was asked to create. */
function client(providers: WorkspaceCatalog["providers"]) {
  const created: Array<{ provider?: unknown }> = [];
  const fake = {
    catalog: { workspaceOptions: async () => ({ agents: [], providers }) },
    workspaces: {
      create: async (input: { provider?: unknown }) => {
        created.push(input);
        return { workspace: { id: "ws1" } };
      },
    },
  } as unknown as GittermClient;
  return { fake, created };
}

const create = (cloud: ReturnType<typeof gittermCloud>, agent: string) =>
  cloud.create({ agent, name: "s", metadata: {}, idempotencyKey: "k" });

test("a move picks a provider that runs the agent when the default doesn't", async () => {
  const { fake, created } = client([
    provider("p-e2b", "e2b", ["opencode", "t3code"], true),
    provider("p-aws", "aws", ["pi"]),
    provider("p-daytona", "daytona", ["opencode", "pi"]),
  ]);
  await create(gittermCloud(fake), "pi");
  // The default when it runs the agent.
  await create(gittermCloud(fake), "t3code");
  // The one asked for, as it is.
  await create(gittermCloud(fake, { provider: "vercel" }), "pi");
  expect(created.map((input) => input.provider)).toEqual([
    { type: "daytona", providerId: "p-daytona" },
    { type: "e2b", providerId: "p-e2b" },
    { type: "vercel" },
  ]);
  await expect(create(gittermCloud(fake), "codex")).rejects.toThrow(
    "None of your GitTerm providers can run codex workspaces.",
  );
});
