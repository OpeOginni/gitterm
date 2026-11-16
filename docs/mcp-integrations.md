# MCP connections and Executor

GitTerm handles saved connection settings, OAuth sign-in, and explicit workspace selection.
OpenCode handles MCP protocol connections, tools, streaming, and its native permission UI. Tool
traffic goes directly from the workspace to the endpoint; it does not consume GitTerm relay
capacity.

Executor uses exactly the same connector as a custom server. It is optional, not a required
dependency or a guarantee of enterprise isolation.

## Setup

1. Deploy migration `0033_mcp_connections`, the API, and the web app. Use OpenCode 2 workspace
   images. T3Code attachments are rejected rather than silently ignored.
2. Configure the production encryption key as described in [credential security](credential-security.md).
3. Enable **MCP servers** and/or **Executor** in **Admin → Integrations**. Both are disabled by
   default and currently support personal connections only.
4. In **Dashboard → Integrations**, add a name and public HTTPS Streamable HTTP endpoint.
   Choose OAuth sign-in, no authentication, a bearer token, or a JSON object of headers.
5. The connection test initializes the server and lists tool metadata; it never invokes a tool.
   A successful test is required for attachment. Test failures remain saved for editing/retesting.
   Signed-in connections are tested when the sign-in completes.
6. Select one or more connections under **MCP tools** when creating an OpenCode workspace.
   OpenCode connects at startup. Confirm runtime status with `opencode mcp list` or `/mcps`.

The test runs from the GitTerm API host, not the workspace. A passed test cannot guarantee the
workspace's network access. Classic initialization-based MCP revisions through `2025-11-25`
are supported; generated entries explicitly use OpenCode's `protocol: "legacy"`. Modern-only
`2026-07-28` servers and stdio installation are not included.

### OAuth sign-in

Sign-in works with servers that publish MCP OAuth metadata and allow dynamic client
registration (Executor does). GitTerm discovers the authorization server from the endpoint's
`401`, registers a public PKCE client whose redirect is `<API_URL>/api/mcp/oauth/callback`, and
requests the advertised scopes plus `offline_access`. The callback must be completed by the
signed-in user who started it. It stores the tokens encrypted on the connection and runs the
connection test.

Workspaces never receive the refresh token. Providers such as Executor rotate refresh tokens and
revoke the whole grant when a superseded one is reused, so one holder must refresh. The generated
OpenCode entry sets `oauth.auth_server_metadata_url` to GitTerm's
`/api/mcp/oauth/authorization-server`, `client_id` to `gitterm-workspace`, and `client_secret` to
`{env:WORKSPACE_AGENT_AUTH_TOKEN}`. The GitTerm credentials plugin seeds OpenCode's credential
store with a placeholder whose refresh token is the connection ID. It waits until OpenCode has
registered the MCP server's integration. On a `401` OpenCode refreshes at `/api/mcp/oauth/token`.
GitTerm checks the workspace identity, its auth version, that the workspace is running or
starting, and that the connection is attached to it. Then it returns the current access token,
refreshing under a row lock when less than ten minutes remain.

When the provider rejects the refresh, the connection becomes **Needs sign-in** and the token
endpoint answers `sign_in_required`, not `invalid_grant`, so OpenCode keeps its placeholder.
Running workspaces recover after the user signs in again. Removing the connection ends
issuance at once.

Up to 50 personal MCP/Executor connections can be saved per user. Workspace creation accepts
up to 32 connection IDs in total, including GitHub/Google. Repeated IDs are deduplicated; MCP
allows multiple accounts while repository and cloud identity selection remains single-valued.

### Executor

**Connect Executor** defaults to Executor Cloud and OAuth sign-in:

```text
https://mcp.executor.sh/mcp
```

For self-hosted Executor, use your public HTTPS origin with the same `/mcp` path. Executor's
sign-in page chooses the organization, the access (all apps, or one scoped connection), and the
approval mode (`model`, `native`, `browser`, or `automatic`). The grant records those choices.
An `?elicitation_mode=` or `?connection=` query on the URL only preselects them.

A personal access token also works: choose **Bearer token**. Use
`https://mcp.executor.sh/org/<organization>/mcp` or, with a single-organization token, the plain
`/mcp` URL. A PAT takes its approval mode from the URL (`model` by default). It keeps full
access to the organization and is refused on scoped connection URLs. It is also readable by the
workspace agent. Prefer sign-in.

### Native OpenCode configuration

Users may also configure MCP directly in OpenCode. GitTerm preserves unrelated saved MCP
configuration and merges attached servers under collision-checked, connection-ID-based names.
See [OpenCode MCP documentation](https://opencode.ai/v2/docs/mcp-servers).

OAuth-only servers can be configured natively where OpenCode's callback is reachable. Do not
assume a loopback callback inside a remote workspace reaches the user's browser. GitTerm does not
provide a browser OAuth callback, central refresh-token storage, or a managed credential relay.
Private endpoints must likewise be configured natively; GitTerm's metadata-test path only accepts
public HTTPS destinations and pins validated DNS addresses to prevent SSRF and rebinding.

## SDK

Use an account token with `integrations:read`, `integrations:write`, and `workspace:write` as needed.

```ts
const result = await client.integrations.connections.create({
  integration: "mcp", // use "executor" for the Executor preset
  name: "Documentation",
  url: "https://mcp.example.com/mcp",
  authentication: { type: "none" },
  codemode: true,
});

if (result.status === "pending") throw new Error("Use authentication none/headers here");
if (result.status === "saved") throw new Error(result.message ?? "Connection needs attention");

const connection = result.connection;
await client.workspaces.create({
  agent: "opencode",
  provider: { type: "railway" },
  connections: [connection.id],
});

await client.integrations.mcp.test(connection.id);
await client.integrations.mcp.update({
  id: connection.id,
  name: "Documentation · work",
  url: "https://mcp.example.com/mcp",
}); // omitted authentication retains the existing encrypted credential

await client.integrations.connections.remove(connection.id);
```

For OAuth servers such as Executor use `authentication: { type: "oauth" }`. The result is
`{ status: "pending", authorizeUrl }`. Open the URL in the user's browser; the connection appears
as connected once they finish. `client.integrations.mcp.authorize(id)` restarts the sign-in for a
connection that shows `needs_auth`. For token-based servers use `authentication: { type:
"headers", headers: { Authorization: "Bearer …" } }` or the provider's API-key header. Never put credentials in endpoint URLs, source
code, or logs. Read/list responses do not expose saved credentials.

## Security and lifecycle

- Selected token/header credentials become workspace environment variables. The agent can read
  them, even though generated configuration only contains environment references.
- Signed-in connections give workspaces only access tokens, which last up to an hour. The agent
  can read those, and its workspace identity can request new ones while the workspace runs.
- Executor can retain underlying service secrets and govern gateway calls. Its PAT remains a
  bearer capability, so possession can authorize calls outside the workspace too.
- Changes apply to newly created workspaces. Removing a saved connection or disabling the
  integration **does not revoke token/header credentials already delivered**. Revoke them at the
  provider. Signed-in connections stop issuing access tokens at once.
- Persisted workspace bindings survive pause/resume, but runtime credential storage follows the
  existing provider bootstrap/persistence model. Native OpenCode reconnects to the upstream server.
- GitTerm records credential issuance metadata without token values. Encryption rewrapping includes
  MCP connections. Connection tests never log upstream errors or credential headers.
- Direct access is not a centrally enforced enterprise boundary. Workspaces with unrestricted
  network access can make independent requests. Use trusted gateways, narrow credentials, and
  network restrictions appropriate to the organization's requirements.

This keeps GitTerm's control plane small. A managed relay and organization-shared connections can
be added separately if customers need central controls.

## Tests

`bun run test`, `bun run check-types`, and `bun run lint` cover the standard checks. The opt-in
`mcp.integration.test.ts` requires a disposable PostgreSQL database whose name ends in `_mcp_test`.
Set `DATABASE_URL` and `MCP_TEST_DATABASE_URL` to that same database, apply committed migrations,
then run `bun test packages/api/src/service/integrations/mcp.integration.test.ts`. Upstream traffic
uses a local SDK fixture; the suite never touches real provider credentials or tools.
