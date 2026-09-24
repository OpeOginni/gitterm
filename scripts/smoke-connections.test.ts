import { expect, test } from "bun:test";
import type { Connection, GittermClient } from "../packages/sdk/src/index.ts";
import { smokeConnections } from "./smoke-connections";

const github: Connection = {
  id: "github:shared",
  integration: "github",
  kind: "shared",
  name: "shared GitHub PAT",
  status: "connected",
  connectedAt: "2026-09-24T00:00:00.000Z",
  details: { integration: "github", mode: "pat", accountLogin: "acme" },
};
const google: Connection = {
  id: "google-id",
  integration: "google",
  kind: "personal",
  name: "Google identity",
  status: "connected",
  connectedAt: "2026-09-24T00:00:00.000Z",
  details: {
    integration: "google",
    projectId: "my-project",
    serviceAccountEmail: "agent@my-project.iam.gserviceaccount.com",
    workloadIdentityProvider:
      "projects/123/locations/global/workloadIdentityPools/gitterm/providers/gitterm",
    setup: {
      issuer: "https://example.com",
      audience: "audience",
      principalSet: "principal",
      attributeMapping: {},
    },
  },
};

function client(connections: Connection[], seen: string[]): GittermClient {
  return {
    integrations: {
      catalog: async () => [
        { key: "github", name: "GitHub", category: "git", allowPersonal: false, allowShared: true },
        {
          key: "google",
          name: "Google Cloud",
          category: "cloud",
          allowPersonal: true,
          allowShared: false,
        },
      ],
      connections: {
        list: async () => connections,
        get: async (id: string) => {
          seen.push(id);
          return connections.find((connection) => connection.id === id)!;
        },
      },
    },
  } as GittermClient;
}

test("smoke discovery uses the SDK without implicitly sharing credentials", async () => {
  const seen: string[] = [];
  expect(await smokeConnections(client([github, google], seen), "")).toEqual([]);
  expect(seen).toEqual([]);
});

test("smoke workspaces attach explicitly selected, connected SDK identities", async () => {
  const seen: string[] = [];
  expect(
    await smokeConnections(client([github, google], seen), " github:shared , google-id "),
  ).toEqual([github, google]);
  expect(seen).toEqual(["github:shared", "google-id"]);
});

test("smoke selection rejects unavailable, suspended, and duplicate identities", async () => {
  const seen: string[] = [];
  const sdk = client([github, { ...google, status: "suspended" }], seen);
  await expect(smokeConnections(sdk, "missing")).rejects.toThrow("not available");
  await expect(smokeConnections(sdk, "google-id")).rejects.toThrow("suspended");
  await expect(smokeConnections(sdk, "github:shared,github:shared")).rejects.toThrow(
    "at most one github",
  );
  await expect(smokeConnections(sdk, "github:shared,")).rejects.toThrow("nonempty");
});
