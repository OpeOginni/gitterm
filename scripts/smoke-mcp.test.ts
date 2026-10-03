import { describe, expect, mock, test } from "bun:test";
import type {
  AgentRun,
  AgentRunMessage,
  AgentRunMessagePart,
  Connection,
  GittermClient,
} from "../packages/sdk/src/index.ts";
import {
  assertSmokeMcpMessages,
  CONTEXT7_URL,
  createSmokeMcp,
  getSmokeMcp,
  runSmokeMcp,
  smokeMcpConnectionId,
  smokeMcpErrorText,
} from "./smoke-mcp";

const id = "00000000-0000-4000-8000-000000000001";
const prefix = `gitterm_${id.replaceAll("-", "_")}_`;
const connection: Connection = {
  id,
  integration: "mcp",
  kind: "personal",
  name: "Context7 smoke",
  status: "connected",
  connectedAt: new Date().toISOString(),
  details: {
    integration: "mcp",
    url: CONTEXT7_URL,
    authType: "none",
    codemode: false,
    toolCount: 2,
    serverInfo: { name: "Context7", version: "4.1.1" },
    lastCheckedAt: new Date().toISOString(),
  },
};

function connectionClient() {
  const inputs: unknown[] = [];
  const client = {
    integrations: {
      async catalog() {
        return [{ key: "mcp", allowPersonal: true }];
      },
      connections: {
        create: mock(async (input: unknown) => {
          inputs.push(input);
          return { status: "connected", connection };
        }),
        remove: mock(async () => {}),
        async get() {
          return connection;
        },
        async list() {
          return [connection];
        },
      },
      mcp: {
        test: mock(async (_id: string) => {
          return { status: "connected", message: "Connected", connection };
        }),
        update: mock(async () => connection),
      },
    },
  } as unknown as GittermClient;
  return { client, inputs };
}

describe("MCP integration ID selection", () => {
  test("selects a saved connection only when requested, with flags taking precedence", () => {
    expect(smokeMcpConnectionId([], {})).toBeUndefined();
    expect(smokeMcpConnectionId(["--provider", "e2b", "--integration-id", id], {})).toBe(id);
    expect(smokeMcpConnectionId([`--integration-id=${id}`], {})).toBe(id);
    expect(smokeMcpConnectionId([], { GITTERM_E2E_MCP_CONNECTION_ID: ` ${id} ` })).toBe(id);
    expect(
      smokeMcpConnectionId(["--integration-id", id], {
        GITTERM_E2E_MCP_CONNECTION_ID: "00000000-0000-4000-8000-000000000002",
      }),
    ).toBe(id);
  });

  test("rejects missing, malformed, and duplicate flags before provisioning", () => {
    for (const argv of [
      ["--integration-id"],
      ["--integration-id="],
      ["--integration-id", "--provider", "e2b"],
      ["--integration-id", "https://mcp.context7.com/mcp"],
      ["--integration-id", `${id},${id}`],
      ["--integration-id", id, `--integration-id=${id}`],
    ]) {
      expect(() => smokeMcpConnectionId(argv, {})).toThrow();
    }
    expect(() => smokeMcpConnectionId([], { GITTERM_E2E_MCP_CONNECTION_ID: " " })).toThrow();
  });
});

describe("saved Context7 connection", () => {
  test("reuses and retests the exact saved ID without creating, editing, or deleting it", async () => {
    const { client } = connectionClient();
    const saved: Connection = {
      ...connection,
      details: { ...connection.details, authType: "headers" } as Connection["details"],
    };
    client.integrations.connections.get = async () => saved;
    await getSmokeMcp(client, id);
    expect(client.integrations.mcp.test).toHaveBeenCalledWith(id);
    expect(client.integrations.connections.create).not.toHaveBeenCalled();
    expect(client.integrations.mcp.update).not.toHaveBeenCalled();
    expect(client.integrations.connections.remove).not.toHaveBeenCalled();
  });

  test("rejects other integrations and endpoints without probing or modifying them", async () => {
    for (const saved of [
      { ...connection, id: "different-id" },
      { ...connection, integration: "github" },
      { ...connection, details: { ...connection.details, url: "https://another.example/mcp" } },
    ]) {
      const { client } = connectionClient();
      client.integrations.connections.get = async () => saved as Connection;
      await expect(getSmokeMcp(client, id)).rejects.toThrow();
      expect(client.integrations.mcp.test).not.toHaveBeenCalled();
    }
  });

  test("explains how to select the direct-tool path instead of silently editing Code Mode", async () => {
    const { client } = connectionClient();
    client.integrations.connections.get = async () => ({
      ...connection,
      details: { ...connection.details, codemode: true } as Connection["details"],
    });
    await expect(getSmokeMcp(client, id)).rejects.toThrow();
    expect(client.integrations.mcp.test).not.toHaveBeenCalled();
  });
});

describe("temporary Context7 connection", () => {
  test("tracks the new connection before a probe failure for caller cleanup", async () => {
    const { client } = connectionClient();
    const onCreated = mock((_id: string) => {});
    client.integrations.mcp.test = async () => {
      expect(onCreated).toHaveBeenCalledWith(id);
      return {
        status: "error",
        message: "Upstream unavailable",
        connection: { ...connection, status: "error" },
      };
    };
    await expect(createSmokeMcp(client, "e2b-test", onCreated, {})).rejects.toThrow();
    expect(onCreated).toHaveBeenCalledWith(id);
  });

  test("fails instead of skipping when MCP is disabled", async () => {
    const { client } = connectionClient();
    client.integrations.catalog = async () => [];
    await expect(createSmokeMcp(client, "test", () => {}, {})).rejects.toThrow("MCP integration");
    expect(client.integrations.connections.create).not.toHaveBeenCalled();
  });

  test.each([undefined, " free-key "])(
    "provisions direct tools with the requested authentication: %s",
    async (apiKey) => {
      const { client, inputs } = connectionClient();
      client.integrations.connections.get = async () => ({
        ...connection,
        details: {
          ...connection.details,
          authType: apiKey ? "headers" : "none",
        } as Connection["details"],
      });
      await createSmokeMcp(client, "test", () => {}, { GITTERM_E2E_CONTEXT7_API_KEY: apiKey });
      expect(inputs[0]).toMatchObject({
        url: CONTEXT7_URL,
        codemode: false,
        authentication: apiKey
          ? { type: "headers", headers: { Authorization: "Bearer free-key" } }
          : { type: "none" },
      });
    },
  );
});

type ToolPart = Extract<AgentRunMessagePart, { type: "tool" }>;
function tool(name: string, input: Record<string, unknown>, output: string): ToolPart {
  return {
    type: "tool",
    callId: name,
    tool: `${prefix}${name}`,
    status: "completed",
    title: null,
    input,
    output,
    error: null,
    startedAt: null,
    completedAt: null,
  };
}
function evidence(): AgentRunMessage[] {
  return [
    {
      id: "message",
      role: "assistant",
      createdAt: new Date().toISOString(),
      completedAt: null,
      text: "",
      error: null,
      parts: [
        tool(
          "resolve-library-id",
          { libraryName: "React", query: "React useEffect cleanup function example" },
          "Title: React\nContext7-compatible library ID: /reactjs/react.dev",
        ),
        tool(
          "query-docs",
          { libraryId: "/reactjs/react.dev", query: "React useEffect cleanup function example" },
          "Source: https://react.dev/reference/react/useEffect\nuseEffect returns a cleanup function.",
        ),
      ],
    },
  ];
}

describe("MCP tool evidence", () => {
  test("accepts completed lookup and documentation calls from the attached server", () => {
    expect(() => assertSmokeMcpMessages(evidence(), id)).not.toThrow();
  });

  test("a plain success reply or a shell/Code Mode call cannot pass", () => {
    for (const name of ["shell", "execute"]) {
      const messages = evidence();
      messages[0]!.text = "GITTERM_MCP_OK";
      messages[0]!.parts = [{ ...tool(name, {}, "GITTERM_MCP_OK"), tool: name }];
      expect(() => assertSmokeMcpMessages(messages, id)).toThrow("observed: none");
    }
  });

  test("another connection's tool calls cannot pass", () => {
    expect(() => assertSmokeMcpMessages(evidence(), "another-connection")).toThrow(
      "observed: none",
    );
  });

  test("rate-limit messages, failed tools, and empty docs cannot pass", () => {
    for (const patch of [
      { output: "Rate limit exceeded. Please get an API key." },
      { output: "" },
      { status: "error" as const },
      { status: "running" as const },
      { error: "Upstream failed" },
    ]) {
      const messages = evidence();
      messages[0]!.parts[1] = { ...messages[0]!.parts[1]!, ...patch } as ToolPart;
      expect(() => assertSmokeMcpMessages(messages, id)).toThrow("query-docs");
    }
  });

  test("requires using a library ID returned by the lookup", () => {
    for (const libraryId of ["/unrelated/library", "/reactjs/react", ""]) {
      const messages = evidence();
      (messages[0]!.parts[1] as ToolPart).input.libraryId = libraryId;
      expect(() => assertSmokeMcpMessages(messages, id)).toThrow("query-docs");
    }
  });

  test("user-supplied tool parts are not proof of execution", () => {
    const messages = evidence();
    messages[0]!.role = "user";
    expect(() => assertSmokeMcpMessages(messages, id)).toThrow("observed: none");
  });

  test("never dumps request inputs or tool outputs when reporting a failure", () => {
    const messages = evidence();
    const resolve = messages[0]!.parts[0] as ToolPart;
    resolve.status = "error";
    resolve.error = "Connection closed";
    resolve.input = { Authorization: "request-secret" };
    resolve.output = "response-secret";
    try {
      assertSmokeMcpMessages(messages, id);
      throw new Error("expected assertion failure");
    } catch (error) {
      expect(String(error)).toContain("Connection closed");
      expect(String(error)).not.toContain("request-secret");
      expect(String(error)).not.toContain("response-secret");
    }
  });
});

test("smoke diagnostics pass environment credentials to the shared redactor", () => {
  const result = smokeMcpErrorText("Connection closed: private-env-key", {
    GITTERM_E2E_CONTEXT7_API_KEY: "private-env-key",
  });
  expect(result).toContain("Connection closed");
  expect(result).not.toContain("private-env-key");
});

const runOptions = { model: "opencode/test", setupTimeoutMs: 360_000, runTimeoutMs: 180_000 };
function runClient() {
  let marker = "";
  const run: AgentRun = {
    id: "run-test",
    workspaceId: "workspace-test",
    title: "MCP",
    status: "running",
    pendingInputs: [],
    finalText: null,
    error: null,
    context: { type: "isolated" },
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    completedAt: null,
  };
  const client = {
    runs: {
      create: mock(async (input: { prompt: string }) => {
        marker = input.prompt.match(/GITTERM_MCP_OK_[\w-]+/)![0];
        return run;
      }),
      wait: mock(async () => {
        return { ...run, status: "completed", finalText: marker };
      }),
      messages: mock(async () => {
        return evidence();
      }),
      cancel: mock(async () => {
        return { cancelled: true };
      }),
    },
  } as unknown as GittermClient;
  return { client, run };
}

describe("managed MCP scenario", () => {
  test("checks tool results as well as the fresh final marker", async () => {
    const { client } = runClient();
    await runSmokeMcp(client, "workspace-test", id, runOptions);
    expect(client.runs.messages).toHaveBeenCalledTimes(1);
    expect(client.runs.cancel).not.toHaveBeenCalled();
  });

  test("rejects a completed run that claims success without calling MCP", async () => {
    const { client } = runClient();
    client.runs.messages = async () => [];
    await expect(runSmokeMcp(client, "workspace-test", id, runOptions)).rejects.toThrow(
      "missing successful resolve-library-id",
    );
  });

  test("cancels a timed-out run instead of leaving billable work running", async () => {
    const { client } = runClient();
    client.runs.wait = async () => {
      throw new Error("timed out");
    };
    await expect(runSmokeMcp(client, "workspace-test", id, runOptions)).rejects.toThrow(
      "timed out",
    );
    expect(client.runs.cancel).toHaveBeenCalledWith(expect.objectContaining({ id: "run-test" }));
  });

  test("unexpected human input fails and cancels the stuck run", async () => {
    const { client, run } = runClient();
    client.runs.wait = async () => ({ ...run, status: "awaiting_input" });
    await expect(runSmokeMcp(client, "workspace-test", id, runOptions)).rejects.toThrow(
      "awaiting_input",
    );
    expect(client.runs.cancel).toHaveBeenCalledWith(expect.objectContaining({ id: "run-test" }));
  });

  test("wrong final markers and failed runs cannot pass", async () => {
    for (const status of ["completed", "failed"] as const) {
      const { client, run } = runClient();
      client.runs.wait = async () => ({ ...run, status, finalText: "GITTERM_MCP_OK_fake" });
      await expect(runSmokeMcp(client, "workspace-test", id, runOptions)).rejects.toThrow(
        status === "failed" ? "finished with failed" : "success marker",
      );
    }
  });
});
