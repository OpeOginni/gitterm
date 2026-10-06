import type {
  AgentRun,
  AgentRunMessage,
  Connection,
  GittermClient,
} from "../packages/sdk/src/index.ts";
import { redactRemoteErrorText } from "../packages/api/src/utils/redact-secrets";

export const CONTEXT7_URL = "https://mcp.context7.com/mcp";

/** Tool errors may echo credentials, so redact before truncating or logging. */
export function smokeMcpErrorText(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const secrets = Object.entries(env)
    .filter(
      ([key, secret]) =>
        /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL/i.test(key) && secret,
    )
    .map(([, secret]) => secret!);
  return redactRemoteErrorText(value, secrets);
}

export function smokeMcpConnectionId(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const flags = argv.filter(
    (arg) => arg === "--integration-id" || arg.startsWith("--integration-id="),
  );
  if (flags.length > 1) throw new Error("Pass --integration-id only once");
  const flag = flags[0];
  const value = flag
    ? flag === "--integration-id"
      ? argv[argv.indexOf(flag) + 1]
      : flag.slice("--integration-id=".length)
    : env.GITTERM_E2E_MCP_CONNECTION_ID;
  if (value === undefined && !flag) return undefined;
  const id = value?.trim();
  if (!id || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) {
    throw new Error(
      "--integration-id / GITTERM_E2E_MCP_CONNECTION_ID must be an MCP connection UUID",
    );
  }
  return id;
}

/** Test a user's saved connection without changing its settings or owning its cleanup. */
export async function getSmokeMcp(client: GittermClient, id: string): Promise<Connection> {
  const connection = await client.integrations.connections.get(id);
  const details = connection.details;
  if (
    connection.id !== id ||
    connection.integration !== "mcp" ||
    connection.kind !== "personal" ||
    details.integration !== "mcp" ||
    details.url !== CONTEXT7_URL
  ) {
    throw new Error("The selected integration ID must belong to a saved Context7 MCP connection");
  }
  if (details.codemode) {
    throw new Error(
      "The selected Context7 connection uses Code Mode. Edit it in Dashboard → Integrations, " +
        "uncheck 'Use OpenCode Code Mode', and save before running this direct-tool smoke test. " +
        "The runner will not change your saved connection settings.",
    );
  }
  return testSmokeMcp(client, id, details.authType);
}

/** Track ownership before checking the response so failed probes are cleaned up too. */
export async function createSmokeMcp(
  client: GittermClient,
  name: string,
  onCreated: (id: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Connection> {
  const catalog = await client.integrations.catalog();
  if (!catalog.some((integration) => integration.key === "mcp" && integration.allowPersonal)) {
    throw new Error("MCP smoke requires the MCP integration enabled with personal connections");
  }
  const apiKey = env.GITTERM_E2E_CONTEXT7_API_KEY?.trim();
  const created = await client.integrations.connections.create({
    integration: "mcp",
    name: `Context7 smoke: ${name}`,
    url: CONTEXT7_URL,
    authentication: apiKey
      ? { type: "headers", headers: { Authorization: `Bearer ${apiKey}` } }
      : { type: "none" },
    // Direct tools leave independently verifiable MCP calls in runs.messages().
    codemode: false,
  });
  if (created.status === "pending") throw new Error("Context7 unexpectedly requires browser auth");
  onCreated(created.connection.id);
  return testSmokeMcp(client, created.connection.id, apiKey ? "headers" : "none");
}

async function testSmokeMcp(
  client: GittermClient,
  id: string,
  authType: "headers" | "none",
): Promise<Connection> {
  const tested = await client.integrations.mcp.test(id);
  if (tested.status !== "connected") {
    throw new Error(`Context7 connection test failed (${tested.status}): ${tested.message}`);
  }
  const connection = await client.integrations.connections.get(id);
  const listed = await client.integrations.connections.list({
    integration: "mcp",
    kind: "personal",
  });
  const details = connection.details;
  if (
    connection.id !== id ||
    connection.integration !== "mcp" ||
    connection.kind !== "personal" ||
    connection.status !== "connected" ||
    details.integration !== "mcp" ||
    details.url !== CONTEXT7_URL ||
    details.codemode !== false ||
    details.authType !== authType ||
    !details.lastCheckedAt ||
    (details.toolCount ?? 0) < 2 ||
    !/context7/i.test(details.serverInfo?.name ?? "") ||
    !listed.some((entry) => entry.id === connection.id && entry.status === "connected")
  ) {
    throw new Error("Context7 connection metadata did not survive SDK test/get/list");
  }
  return connection;
}

export function smokeMcpPrompt(connectionId: string, marker: string): string {
  const server = `gitterm_${connectionId.replaceAll("-", "_")}`;
  return [
    `Test the attached Context7 MCP server ${server}.`,
    `Call its ${server}_resolve-library-id tool with libraryName="React" and query="React useEffect cleanup function example".`,
    `Then call its ${server}_query-docs tool with a React libraryId returned by that first call and query="React useEffect cleanup function example".`,
    "Use these MCP tools directly, not shell, HTTP, web search, Code Mode, or another server. Do not modify files or ask questions.",
    `Only after both tools return real library results and documentation, reply with exactly ${marker} and no other text. If either fails, report the failure instead.`,
  ].join("\n");
}

/** An agent's success claim alone is not evidence that MCP worked. */
export function assertSmokeMcpMessages(messages: AgentRunMessage[], connectionId: string): void {
  const prefix = `gitterm_${connectionId.replaceAll("-", "_")}_`;
  const tools = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "tool")
    .filter((part) => part.tool.startsWith(prefix));
  const resolve = tools.find(
    (part) =>
      part.tool === `${prefix}resolve-library-id` &&
      part.status === "completed" &&
      !part.error &&
      /^react$/i.test(String(part.input.libraryName)) &&
      /Context7-compatible library ID:\s*\/[^\s]+/i.test(part.output ?? ""),
  );
  const libraryIds = new Set(
    Array.from(
      (resolve?.output ?? "").matchAll(/Context7-compatible library ID:\s*(\/[^\s]+)/gi),
      (match) => match[1],
    ),
  );
  const docs = tools.find(
    (part) =>
      part.tool === `${prefix}query-docs` &&
      part.status === "completed" &&
      !part.error &&
      typeof part.input.libraryId === "string" &&
      libraryIds.has(part.input.libraryId) &&
      /useEffect/.test(part.output ?? "") &&
      /Source:\s*https:\/\//i.test(part.output ?? ""),
  );
  if (!resolve || !docs) {
    // Capture the error before cleanup; never dump request inputs or raw output.
    const errors = tools
      .filter((part) => part.status === "error" || part.error)
      .map(
        (part) =>
          `${part.tool}: ${smokeMcpErrorText(part.error ?? "Tool failed without error details")}`,
      );
    throw new Error(
      `Context7 MCP smoke: missing successful ${!resolve ? "resolve-library-id" : "query-docs"} ` +
        `tool evidence (observed: ${tools.map((part) => `${part.tool}:${part.status}`).join(", ") || "none"}). ` +
        "Check workspace MCP provisioning, outbound access, and Context7 rate limits." +
        (errors.length ? `\nTool errors:\n${errors.join("\n")}` : ""),
    );
  }
}

export async function runSmokeMcp(
  client: GittermClient,
  workspaceId: string,
  connectionId: string,
  options: { model: string; setupTimeoutMs: number; runTimeoutMs: number },
): Promise<void> {
  const marker = `GITTERM_MCP_OK_${crypto.randomUUID()}`;
  let run: AgentRun | undefined;
  try {
    run = await client.runs.create({
      workspace: workspaceId,
      title: "Context7 MCP smoke test",
      model: options.model,
      prompt: smokeMcpPrompt(connectionId, marker),
      waitForSetup: true,
      setupTimeoutMs: options.setupTimeoutMs,
    });
    run = await client.runs.wait(run, { timeoutMs: options.runTimeoutMs });
    if (run.status !== "completed") {
      throw new Error(
        `Context7 MCP run ${run.id} finished with ${run.status}` +
          (run.error ? `: ${smokeMcpErrorText(run.error)}` : ""),
      );
    }
    assertSmokeMcpMessages(await client.runs.messages(run), connectionId);
    if (run.finalText?.trim() !== marker) {
      throw new Error(`Context7 MCP run ${run.id} did not return its success marker`);
    }
  } catch (error) {
    const message = smokeMcpErrorText(error instanceof Error ? error.message : String(error));
    // Keep diagnostic context without attaching a raw, potentially secret-bearing cause.
    const cause = new Error(message);
    if (error instanceof Error) {
      cause.name = error.name;
      cause.stack = smokeMcpErrorText(error.stack ?? message);
    }
    // oxlint-disable-next-line eslint/preserve-caught-error -- Only attach the redacted cause.
    throw new Error(
      `Context7 MCP failure (workspace: ${workspaceId}, run: ${run?.id ?? "not created"}): ${message}`,
      { cause },
    );
  } finally {
    if (run && !["completed", "failed", "cancelled"].includes(run.status)) {
      // Propagate cancellation failures: a stuck billable run must not look successful.
      await client.runs.cancel(run);
    }
  }
}
