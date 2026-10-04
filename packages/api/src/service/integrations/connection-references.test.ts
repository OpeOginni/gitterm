import { describe, expect, test } from "bun:test";
import { matchConnectionReference } from "./connection-references";
import type { Connection } from "./connections";

const github = (id: string, login: string, kind: "personal" | "shared" = "personal") =>
  ({
    id,
    integration: "github",
    kind,
    name: `${login} (${kind === "shared" ? "shared PAT" : "GitHub App"})`,
    status: "connected",
    connectedAt: new Date(0),
    details: {
      integration: "github",
      mode: kind === "shared" ? "pat" : "app",
      accountLogin: login,
    },
  }) as Connection;
const tool = (id: string, name: string, integration: "mcp" | "executor" = "mcp") =>
  ({
    id,
    integration,
    kind: "personal",
    name,
    status: "connected",
    connectedAt: new Date(0),
    details: { integration },
  }) as unknown as Connection;

const repo = "https://github.com/Acme/app";

describe("matchConnectionReference", () => {
  test("github picks the connection covering the repository owner", () => {
    const connections = [
      github("g1", "someone"),
      github("g2", "acme"),
      github("github:shared", "bot", "shared"),
    ];
    expect(matchConnectionReference("github", connections, repo).id).toBe("g2");
  });

  test("github falls back to the shared PAT, never another owner's installation", () => {
    expect(
      matchConnectionReference(
        "GitHub",
        [github("g1", "someone"), github("github:shared", "bot", "shared")],
        repo,
      ).id,
    ).toBe("github:shared");
    expect(() => matchConnectionReference("github", [github("g1", "someone")], repo)).toThrow(
      "None of your GitHub connections covers acme",
    );
    expect(() => matchConnectionReference("github", [], repo)).toThrow("Connect GitHub");
  });

  test("an integration key needs exactly one connection of that kind", () => {
    expect(
      matchConnectionReference("executor", [tool("e1", "Executor", "executor")], repo).id,
    ).toBe("e1");
    expect(() =>
      matchConnectionReference("mcp", [tool("m1", "Docs"), tool("m2", "Linear")], repo),
    ).toThrow('several MCP server connections: "Docs" (m1), "Linear" (m2)');
  });

  test("names match case-insensitively and must be unique", () => {
    expect(
      matchConnectionReference("linear", [tool("m1", "Docs"), tool("m2", "Linear")], repo).id,
    ).toBe("m2");
    expect(() =>
      matchConnectionReference("Docs", [tool("m1", "Docs"), tool("m3", "docs")], repo),
    ).toThrow('Several connections are named "Docs"');
    expect(() => matchConnectionReference("Sentry", [tool("m1", "Docs")], repo)).toThrow(
      'No connection is named "Sentry". Your connections: "Docs" (m1).',
    );
  });
});
