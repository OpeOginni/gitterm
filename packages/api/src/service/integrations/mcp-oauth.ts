/**
 * GitTerm holds MCP refresh tokens and serializes refreshes to prevent token reuse.
 * Workspaces authenticate with their agent identity and receive only access tokens.
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

// Must exceed OpenCode's refresh margin.
const MIN_REMAINING_MS = 10 * 60 * 1000;

const authContext = (id: string) => `gitterm:mcp:${id}:auth`;
const oauthUrl = (path: string) =>
  apiPath(env.API_URL || env.BASE_URL || `http://${env.BASE_DOMAIN}`, `mcp/oauth/${path}`);
export const mcpOAuthCallbackUrl = () => oauthUrl("callback");
export const mcpOAuthIssuer = () => oauthUrl("issuer");
export const mcpOAuthMetadataUrl = () => oauthUrl("authorization-server");

/** The authorization server, and the client registered with it, that a sign-in uses. */
const oauthSession = z.object({
  authorizationServer: z.string(),
  metadata: z.looseObject({}).optional(),
  client: z.looseObject({ client_id: z.string() }),
  redirectUri: z.string(),
  resource: z.string(),
});
export const storedMcpOAuth = z.object({
  type: z.literal("oauth"),
  /** The active grant: its tokens only work with the client and server that issued them. */
  grant: oauthSession
    .extend({
      tokens: z.object({ access: z.string(), refresh: z.string().optional(), expires: z.number() }),
    })
    .optional(),
  /** A sign-in in progress. It replaces the grant, as a whole, only when its callback completes. */
  pending: oauthSession.extend({ state: z.string(), verifier: z.string() }).optional(),
});
export type StoredMcpOAuth = z.infer<typeof storedMcpOAuth>;

/** Safe to show the user or the workspace; anything else is reported generically. */
export class McpOAuthError extends Error {}
class McpEndpointChangedError extends Error {}

function encrypt(id: string, value: StoredMcpOAuth) {
  return getEncryptionService().encrypt(JSON.stringify(value), authContext(id));
}

function decrypt(id: string, encryptedAuth: string): StoredMcpOAuth | null {
  const parsed = storedMcpOAuth.safeParse(
    JSON.parse(getEncryptionService().decrypt(encryptedAuth, authContext(id))),
  );
  return parsed.success ? parsed.data : null;
}

// Share the refresh lock so stale reads cannot restore superseded tokens.
async function updateStoredAuth(
  id: string,
  change: (
    current: StoredMcpOAuth | null,
    row: { revision: number; authType: string },
  ) => StoredMcpOAuth,
  fields: Partial<typeof mcpConnection.$inferInsert> = {},
) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        encryptedAuth: mcpConnection.encryptedAuth,
        revision: mcpConnection.revision,
        authType: mcpConnection.authType,
      })
      .from(mcpConnection)
      .where(eq(mcpConnection.id, id))
      .for("update");
    if (!row) throw new McpOAuthError("This connection was removed");
    await tx
      .update(mcpConnection)
      .set({
        ...fields,
        encryptedAuth: encrypt(id, change(decrypt(id, row.encryptedAuth), row)),
        updatedAt: new Date(),
      })
      .where(eq(mcpConnection.id, id));
  });
}

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
  // Refresh conservatively when the server omits a lifetime.
  expires: Date.now() + (tokens.expires_in ?? 30 * 60) * 1000,
});

/** Starts sign-in and returns the authorization URL. */
export async function startMcpOAuth(row: typeof mcpConnection.$inferSelect): Promise<string> {
  const fetchFn = mcpFetchWithin(AbortSignal.timeout(60_000));
  try {
    // Read discovery hints from the server's 401 challenge.
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
    const reusable = [previous?.grant, previous?.pending].find(
      (session) =>
        session?.authorizationServer === info.authorizationServerUrl &&
        session.redirectUri === redirectUri,
    );
    const client =
      reusable?.client ??
      (await registerClient(info.authorizationServerUrl, {
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
      }));
    const scopes = new Set(
      (challenge.scope ?? info.resourceMetadata?.scopes_supported?.join(" ") ?? "")
        .split(" ")
        .filter(Boolean),
    );
    // Some servers require offline_access to issue a refresh token.
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
    await updateStoredAuth(row.id, (current, locked) => {
      // Discovery ran against the endpoint as it was read. If the connection was edited since,
      // this sign-in would grant the old endpoint's access under the new settings.
      if (locked.revision !== row.revision || locked.authType !== "oauth")
        throw new McpOAuthError(
          "This connection changed while the sign-in was starting. Start it again.",
        );
      return {
        type: "oauth",
        // Running workspaces keep using the active grant, as last refreshed, until this
        // sign-in completes. Its client and server stay with it.
        grant: current?.grant,
        pending: {
          authorizationServer: info.authorizationServerUrl,
          metadata,
          client,
          redirectUri,
          resource,
          state,
          verifier: codeVerifier,
        },
      };
    });
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

/** Completes sign-in for its owner and returns the connection ID. */
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
  const pending = row && decrypt(row.id, row.encryptedAuth)?.pending;
  if (
    !row ||
    !pending ||
    pending.state.length !== input.state.length ||
    !timingSafeEqual(Buffer.from(pending.state), Buffer.from(input.state))
  )
    throw new McpOAuthError("This sign-in expired or was already used. Start it again.");
  const metadata = pending.metadata as AuthorizationServerMetadata | undefined;
  if (input.iss !== undefined && metadata?.issuer && input.iss !== metadata.issuer)
    throw new McpOAuthError("The sign-in came back from an unexpected issuer");
  let tokens;
  try {
    tokens = await exchangeAuthorization(pending.authorizationServer, {
      metadata,
      clientInformation: pending.client,
      authorizationCode: input.code,
      codeVerifier: pending.verifier,
      redirectUri: pending.redirectUri,
      resource: pending.resource,
      fetchFn: mcpFetchWithin(AbortSignal.timeout(30_000)),
    });
  } catch (error) {
    console.warn(`[mcp] OAuth code exchange failed for ${row.id}:`, error);
    throw new McpOAuthError("The server refused the sign-in. Try again.");
  }
  await updateStoredAuth(
    row.id,
    (current) => {
      if (current?.pending?.state !== input.state)
        throw new McpOAuthError("A newer sign-in replaced this one. Finish that one instead.");
      const { state: _state, verifier: _verifier, ...session } = current.pending;
      return { type: "oauth", grant: { ...session, tokens: toTokens(tokens) } };
    },
    { status: "untested" },
  );
  return row.id;
}

/** Returns an access token, serializing refreshes under the connection's row lock. */
export async function getMcpAccessToken(
  connectionId: string,
  /** Refuse tokens for a different endpoint. */
  url: string,
): Promise<{ access: string; expires: number }> {
  const token = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ encryptedAuth: mcpConnection.encryptedAuth, url: mcpConnection.url })
      .from(mcpConnection)
      .where(eq(mcpConnection.id, connectionId))
      .for("update");
    if (row && row.url !== url) throw new McpEndpointChangedError();
    const auth = row && decrypt(connectionId, row.encryptedAuth);
    const grant = auth?.grant;
    if (!auth || !grant) throw new McpOAuthError("Sign in to this connection again in GitTerm");
    const current = grant.tokens;
    if (current.expires > Date.now() + MIN_REMAINING_MS) return current;
    if (!current.refresh) throw new McpOAuthError("Sign in to this connection again in GitTerm");
    let next;
    try {
      next = await refreshAuthorization(grant.authorizationServer, {
        metadata: grant.metadata as AuthorizationServerMetadata | undefined,
        clientInformation: grant.client,
        refreshToken: current.refresh,
        resource: grant.resource,
        fetchFn: mcpFetchWithin(AbortSignal.timeout(30_000)),
      });
    } catch (error) {
      if (
        error instanceof OAuthError &&
        ["invalid_grant", "invalid_client", "unauthorized_client"].includes(error.errorCode)
      ) {
        await tx
          .update(mcpConnection)
          .set({
            // A sign-in in progress stays; it is the way back.
            encryptedAuth: encrypt(connectionId, { ...auth, grant: undefined }),
            status: "needs_auth",
            toolCount: null,
            serverInfo: null,
            updatedAt: new Date(),
          })
          .where(eq(mcpConnection.id, connectionId));
        // Throw after commit so the needs_auth update survives.
        return null;
      }
      throw error;
    }
    const tokens = { ...toTokens(next), refresh: next.refresh_token ?? current.refresh };
    await tx
      .update(mcpConnection)
      .set({
        encryptedAuth: encrypt(connectionId, { ...auth, grant: { ...grant, tokens } }),
        updatedAt: new Date(),
      })
      .where(eq(mcpConnection.id, connectionId));
    return tokens;
  });
  if (!token)
    throw new McpOAuthError("The sign-in expired or was revoked. Sign in again in GitTerm.");
  return token;
}

export function mcpOAuthServerMetadata() {
  return {
    issuer: mcpOAuthIssuer(),
    // Required by the metadata schema, but workspaces only refresh.
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
 * The connection ID is the refresh token; the workspace identity is the client secret.
 * Reserve invalid_grant/invalid_client for permanent failures: OpenCode deletes the credential.
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
      url: mcpConnection.url,
      provisionedUrl: workspaceMcpConnection.url,
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
  // Never send a new endpoint's token to a workspace configured for the old one.
  if (record.provisionedUrl !== record.url)
    return tokenError(400, "invalid_grant", "This connection now points to another endpoint");
  // OpenCode connects while the workspace is still starting.
  if (record.status !== "running" && record.status !== "pending")
    return tokenError(401, "invalid_client", "Workspace is not running");
  const policy = await integrationPolicy(record.integration);
  if (!policy.enabled || !policy.allowPersonal)
    return tokenError(400, "access_denied", "This integration is disabled by your admin");

  try {
    const token = await getMcpAccessToken(connectionId, record.url);
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
    if (error instanceof McpEndpointChangedError)
      return tokenError(400, "invalid_grant", "This connection now points to another endpoint");
    if (error instanceof McpOAuthError) return tokenError(400, "sign_in_required", error.message);
    console.warn(`[mcp] workspace token refresh failed for ${connectionId}:`, error);
    return tokenError(503, "temporarily_unavailable", "Could not refresh the token. Try again.");
  }
}
