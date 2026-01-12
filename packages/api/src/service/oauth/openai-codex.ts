/**
 * OpenAI Codex OAuth Token Utilities
 *
 * Provides utilities for refreshing OpenAI Codex OAuth tokens.
 * Users authenticate via the OpenCode CLI and paste their auth.json tokens.
 *
 * Flow:
 * 1. User runs `opencode` CLI and authenticates with OpenAI
 * 2. User copies tokens from ~/.local/share/opencode/auth.json
 * 3. User pastes tokens into GitTerm dashboard
 * 4. GitTerm stores and refreshes tokens as needed
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

// ==================== JWT Parsing ====================

export interface IdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  } catch {
    return undefined;
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

// ==================== Token Types ====================

export interface CodexTokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface CodexOAuthResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  accountId?: string;
}

// ==================== Token Refresh ====================

async function refreshAccessToken(refreshToken: string): Promise<CodexTokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<CodexTokenResponse>;
}

function extractAccountId(tokens: CodexTokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token);
    const accountId = claims && extractAccountIdFromClaims(claims);
    if (accountId) return accountId;
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token);
    return claims ? extractAccountIdFromClaims(claims) : undefined;
  }
  return undefined;
}

// ==================== Public Service Interface ====================

/**
 * OpenAI Codex OAuth Service
 *
 * Provides token refresh functionality for Codex OAuth tokens.
 */
export class OpenAICodexOAuthService {
  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns New tokens
   */
  static async refreshToken(refreshToken: string): Promise<CodexOAuthResult> {
    const tokens = await refreshAccessToken(refreshToken);
    const accountId = extractAccountId(tokens);

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId,
    };
  }

  /**
   * Get the Codex API endpoint URL.
   */
  static getApiEndpoint(): string {
    return CODEX_API_ENDPOINT;
  }

  /**
   * Get the provider ID for this service.
   */
  static getProviderId(): string {
    return "openai-codex";
  }
}
