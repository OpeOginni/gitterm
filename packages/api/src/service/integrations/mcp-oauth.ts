/**
 * OAuth sign-in for MCP connections, such as Executor.
 *
 * GitTerm runs the browser sign-in and keeps the only refresh token: providers like Executor
 * rotate refresh tokens and revoke the whole grant when a superseded one is reused, so
 * workspaces must never hold their own copy. Each workspace's OpenCode instead refreshes
 * against GitTerm's token endpoint, using its workspace identity as the client secret, and
 * one locked refresh per connection serves every workspace.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, db, eq } from "@gitterm/db";
import { mcpConnection, workspaceMcpConnection } from "@gitterm/db/schema/mcp";
import { workspace } from "@gitterm/db/schema/workspace";
import env from "@gitterm/env/server";
import { apiPath } from "@gitterm/schema/url";
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationServerMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
import { workspaceJWT } from "../auth/workspace-jwt";
import { recordCredentialAudit } from "../credential-audit";
import { getEncryptionService } from "../encryption";
import { integrationPolicy } from "./catalog";
import { MCP_OAUTH_WORKSPACE_CLIENT } from "./mcp-config";
import { McpNetworkError, mcpFetchWithin } from "./mcp-network";

/** Longer than OpenCode's refresh margin, so a returned token is not refreshed again at once. */
const MIN_REMAINING_MS = 10 * 60 * 1000;

const authContext = (id: string) => `gitterm:mcp:${id}:auth`;
const oauthUrl = (path: string) =>
  apiPath(env.API_URL || env.BASE_URL || `http://${env.BASE_DOMAIN}`, `mcp/oauth/${path}`);
export const mcpOAuthCallbackUrl = () => oauthUrl("callback");
export const mcpOAuthIssuer = () => oauthUrl("issuer");
export const mcpOAuthMetadataUrl = () => oauthUrl("authorization-server");

/** What GitTerm stores, encrypted, for an OAuth connection. Workspaces never receive it. */
export const storedMcpOAuth = z.object({
  type: z.literal("oauth"),
  authorizationServer: z.string().optional(),
  metadata: z.looseObject({}).optional(),
  client: z.looseObject({ client_id: z.string() }).optional(),
  redirectUri: z.string().optional(),
  resource: z.string().optional(),
  pending: z.object({ state: z.string(), verifier: z.string() }).optional(),
  tokens: z
    .object({ access: z.string(), refresh: z.string().optional(), expires: z.number() })
    .optional(),
});
export type StoredMcpOAuth = z.infer<typeof storedMcpOAuth>;

/** Safe to show the user or the workspace; anything else is reported generically. */
export class McpOAuthError extends Error {}

function encrypt(id: string, value: StoredMcpOAuth) {
  return getEncryptionService().encrypt(JSON.stringify(value), authContext(id));
}

function decrypt(id: string, encryptedAuth: string): StoredMcpOAuth | null {
  const parsed = storedMcpOAuth.safeParse(
    JSON.parse(getEncryptionService().decrypt(encryptedAuth, authContext(id))),
  );
  return parsed.success ? parsed.data : null;
}

/** Tokens are bound to the URL the user saved, as OpenCode binds them, unless the server names another. */
function selectResource(url: string, advertised: string | undefined): string {
  const identity = new URL(url);
  identity.hash = "";
  if (!advertised) return identity.toString();
  const canonical = new URL(advertised);
  return canonical.origin === identity.origin && canonical.pathname === identity.pathname
    ? identity.toString()
    : canonical.toString();
}

const toTokens = (tokens: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}) => ({
  access: tokens.access_token,
  refresh: tokens.refresh_token,
  // Without a lifetime, refresh well before a typical hour so workspaces rarely see a 401.
  expires: Date.now() + (tokens.expires_in ?? 30 * 60) * 1000,
});

/**
 * Starts a browser sign-in for a saved connection and returns the URL to open. The client
 * registered on an earlier sign-in is reused while the authorization server is unchanged.
 */
export async function startMcpOAuth(row: typeof mcpConnection.$inferSelect): Promise<string> {
  const fetchFn = mcpFetchWithin(AbortSignal.timeout(60_000));
  try {
    // The 401 names the resource metadata and scopes; without it discovery can only guess.
    const challenge = await fetchFn(row.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "gitterm", version: "1.0.0" },
        },
      }),
    }).then(
      async (response) => {
        await response.body?.cancel().catch(() => undefined);
        return extractWWWAuthenticateParams(response);
      },
      () => ({ resourceMetadataUrl: undefined, scope: undefined }),
    );
    const info = await discoverOAuthServerInfo(row.url, {
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      fetchFn,
    });
    const metadata = info.authorizationServerMetadata;
    if (!metadata) throw new McpOAuthError("This server does not publish OAuth sign-in metadata");
    const redirectUri = mcpOAuthCallbackUrl();
    const previous = decrypt(row.id, row.encryptedAuth);
    const client =
      previous?.client &&
      previous.authorizationServer === info.authorizationServerUrl &&
      previous.redirectUri === redirectUri
        ? previous.client
        : await registerClient(info.authorizationServerUrl, {
            metadata,
            clientMetadata: {
              client_name: "GitTerm",
              client_uri: env.BASE_URL || undefined,
              redirect_uris: [redirectUri],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            },
            fetchFn,
          });
    const scopes = new Set(
      (challenge.scope ?? info.resourceMetadata?.scopes_supported?.join(" ") ?? "")
        .split(" ")
        .filter(Boolean),
    );
    // Without offline access some servers issue no refresh token, and workspaces stop after an hour.
    if (metadata.scopes_supported?.includes("offline_access")) scopes.add("offline_access");
    const resource = selectResource(row.url, info.resourceMetadata?.resource);
    const state = `${row.id}.${randomBytes(32).toString("base64url")}`;
    const { authorizationUrl, codeVerifier } = await startAuthorization(
      info.authorizationServerUrl,
      {
        metadata,
        clientInformation: client,
        redirectUrl: redirectUri,
        scope: scopes.size ? [...scopes].join(" ") : undefined,
        state,
        resource,
      },
    );
    if (authorizationUrl.protocol !== "https:")
      throw new McpOAuthError("The server's sign-in page is not served over HTTPS");
    await db
      .update(mcpConnection)
      .set({
        encryptedAuth: encrypt(row.id, {
          type: "oauth",
          authorizationServer: info.authorizationServerUrl,
          metadata,
          client,
          redirectUri,
          resource,
          pending: { state, verifier: codeVerifier },
          // Running workspaces keep using the current grant until the new one replaces it.
          tokens: previous?.tokens,
        }),
        updatedAt: new Date(),
      })
      .where(eq(mcpConnection.id, row.id));
    return authorizationUrl.toString();
  } catch (error) {
    if (error instanceof McpOAuthError || error instanceof McpNetworkError)
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    console.warn(`[mcp] OAuth sign-in could not start for ${row.id}:`, error);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Could not start the sign-in. Check that the endpoint supports MCP OAuth sign-in.",
    });
  }
}

/** Completes the browser sign-in for the user who started it. Returns the connection id. */
export async function completeMcpOAuth(
  userId: string,
  input: { state: string; code: string; iss?: string },
): Promise<string> {
  const id = input.state.split(".")[0] ?? "";
  if (!z.uuid().safeParse(id).success) throw new McpOAuthError("Unknown sign-in");
  const [row] = await db
    .select()
    .from(mcpConnection)
    .where(and(eq(mcpConnection.id, id), eq(mcpConnection.userId, userId)));
  const auth = row && decrypt(row.id, row.encryptedAuth);
  const pending = auth?.pending;
  if (
    !row ||
    !auth?.authorizationServer ||
    !auth.client ||
    !auth.redirectUri ||
    !pending ||
    pending.state.length !== input.state.length ||
    !timingSafeEqual(Buffer.from(pending.state), Buffer.from(input.state))
  )
    throw new McpOAuthError("This sign-in expired or was already used. Start it again.");
  const metadata = auth.metadata as AuthorizationServerMetadata | undefined;
  if (input.iss !== undefined && metadata?.issuer && input.iss !== metadata.issuer)
    throw new McpOAuthError("The sign-in came back from an unexpected issuer");
  let tokens;
  try {
    tokens = await exchangeAuthorization(auth.authorizationServer, {
      metadata,
      clientInformation: auth.client,
      authorizationCode: input.code,
      codeVerifier: pending.verifier,
      redirectUri: auth.redirectUri,
      resource: auth.resource,
      fetchFn: mcpFetchWithin(AbortSignal.timeout(30_000)),
    });
  } catch (error) {
    console.warn(`[mcp] OAuth code exchange failed for ${row.id}:`, error);
    throw new McpOAuthError("The server refused the sign-in. Try again.");
  }
  await db
    .update(mcpConnection)
    .set({
      encryptedAuth: encrypt(row.id, { ...auth, pending: undefined, tokens: toTokens(tokens) }),
      status: "untested",
      updatedAt: new Date(),
    })
    .where(eq(mcpConnection.id, row.id));
  return row.id;
}

/**
 * The connection's access token, refreshed first when it expires within `MIN_REMAINING_MS`.
 * The row lock makes concurrent callers wait and reuse one refresh.
 */
export async function getMcpAccessToken(
  connectionId: string,
): Promise<{ access: string; expires: number }> {
  const token = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ encryptedAuth: mcpConnection.encryptedAuth })
      .from(mcpConnection)
      .where(eq(mcpConnection.id, connectionId))
      .for("update");
    const auth = row && decrypt(connectionId, row.encryptedAuth);
    const current = auth?.tokens;
    if (!auth || !current) throw new McpOAuthError("Sign in to this connection again in GitTerm");
    if (current.expires > Date.now() + MIN_REMAINING_MS) return current;
    if (!current.refresh || !auth.authorizationServer || !auth.client)
      throw new McpOAuthError("Sign in to this connection again in GitTerm");
    let next;
    try {
      next = await refreshAuthorization(auth.authorizationServer, {
        metadata: auth.metadata as AuthorizationServerMetadata | undefined,
        clientInformation: auth.client,
        refreshToken: current.refresh,
        resource: auth.resource,
        fetchFn: mcpFetchWithin(AbortSignal.timeout(30_000)),
      });
    } catch (error) {
      if (
        error instanceof OAuthError &&
        ["invalid_grant", "invalid_client", "unauthorized_client"].includes(error.errorCode)
      ) {
        // Only a new sign-in helps; keep the client so it is reused.
        await tx
          .update(mcpConnection)
          .set({
            encryptedAuth: encrypt(connectionId, { ...auth, tokens: undefined }),
            status: "needs_auth",
            toolCount: null,
            serverInfo: null,
            updatedAt: new Date(),
          })
          .where(eq(mcpConnection.id, connectionId));
        // Thrown after the transaction, which would otherwise roll this update back.
        return null;
      }
      throw error;
    }
    const tokens = { ...toTokens(next), refresh: next.refresh_token ?? current.refresh };
    await tx
      .update(mcpConnection)
      .set({ encryptedAuth: encrypt(connectionId, { ...auth, tokens }), updatedAt: new Date() })
      .where(eq(mcpConnection.id, connectionId));
    return tokens;
  });
  if (!token)
    throw new McpOAuthError("The sign-in expired or was revoked. Sign in again in GitTerm.");
  return token;
}

/** The authorization server document OpenCode reads instead of the MCP server's own. */
export function mcpOAuthServerMetadata() {
  return {
    issuer: mcpOAuthIssuer(),
    // Unused: workspaces only refresh. Present because the metadata format requires it.
    authorization_endpoint: oauthUrl("authorize"),
    token_endpoint: oauthUrl("token"),
    response_types_supported: ["code"],
    grant_types_supported: ["refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  };
}

type TokenResponse = { status: 200 | 400 | 401 | 503; body: Record<string, unknown> };
const tokenError = (status: TokenResponse["status"], error: string, description: string) => ({
  status,
  body: { error, error_description: description },
});

/**
 * GitTerm's token endpoint for workspaces. The refresh token is the connection ID and the client
 * secret is the workspace's agent identity, so a workspace receives access tokens only for the
 * connections attached to it, while it runs.
 *
 * OpenCode deletes its credential on `invalid_grant`/`invalid_client`, so those are returned only
 * when the workspace can never use this connection again. A connection that needs a new sign-in
 * returns another error, and the workspace recovers once the user signs in again.
 */
export async function issueWorkspaceMcpToken(form: URLSearchParams): Promise<TokenResponse> {
  if (form.get("grant_type") !== "refresh_token")
    return tokenError(400, "unsupported_grant_type", "Only refresh_token is supported");
  if (form.get("client_id") !== MCP_OAUTH_WORKSPACE_CLIENT)
    return tokenError(401, "invalid_client", "Unknown client");
  let identity;
  try {
    identity = workspaceJWT.verifyToken(form.get("client_secret") ?? "", "agent");
  } catch {
    return tokenError(401, "invalid_client", "Invalid workspace identity");
  }
  if (!workspaceJWT.hasScope(identity, "agent:credential"))
    return tokenError(401, "invalid_client", "Insufficient workspace scope");
  const connectionId = form.get("refresh_token") ?? "";
  if (!z.uuid().safeParse(connectionId).success)
    return tokenError(400, "invalid_grant", "Unknown connection");

  const [record] = await db
    .select({
      status: workspace.status,
      authVersion: workspace.authVersion,
      integration: mcpConnection.integration,
      authType: mcpConnection.authType,
    })
    .from(workspaceMcpConnection)
    .innerJoin(workspace, eq(workspace.id, workspaceMcpConnection.workspaceId))
    .innerJoin(mcpConnection, eq(mcpConnection.id, workspaceMcpConnection.connectionId))
    .where(
      and(
        eq(workspaceMcpConnection.workspaceId, identity.workspaceId),
        eq(workspaceMcpConnection.connectionId, connectionId),
        eq(workspace.userId, identity.userId),
        eq(mcpConnection.userId, identity.userId),
      ),
    );
  if (!record || record.authType !== "oauth" || record.authVersion !== identity.authVersion)
    return tokenError(400, "invalid_grant", "This connection is not attached to this workspace");
  // OpenCode connects while the workspace is still starting.
  if (record.status !== "running" && record.status !== "pending")
    return tokenError(401, "invalid_client", "Workspace is not running");
  const policy = await integrationPolicy(record.integration);
  if (!policy.enabled || !policy.allowPersonal)
    return tokenError(400, "access_denied", "This integration is disabled by your admin");

  try {
    const token = await getMcpAccessToken(connectionId);
    await recordCredentialAudit({
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      credentialKind: "mcp",
      integrationId: connectionId,
      action: "issued",
      expiresAt: new Date(token.expires).toISOString(),
    });
    return {
      status: 200,
      body: {
        access_token: token.access,
        token_type: "Bearer",
        expires_in: Math.max(0, Math.floor((token.expires - Date.now()) / 1000)),
      },
    };
  } catch (error) {
    if (error instanceof McpOAuthError) return tokenError(400, "sign_in_required", error.message);
    console.warn(`[mcp] workspace token refresh failed for ${connectionId}:`, error);
    return tokenError(503, "temporarily_unavailable", "Could not refresh the token. Try again.");
  }
}
