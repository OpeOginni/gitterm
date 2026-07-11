/**
 * OpenAI OAuth token utilities
 *
 * Implements the ChatGPT device authorization and token refresh flows.
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
const DEVICE_API_ENDPOINT = `${ISSUER}/api/accounts/deviceauth`;
const DEVICE_VERIFICATION_URL = `${ISSUER}/codex/device`;
const DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`;

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

export interface OpenAITokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface OpenAIOAuthResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  accountId?: string;
}

export interface OpenAIDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

// ==================== Token Refresh ====================

async function refreshAccessToken(refreshToken: string): Promise<OpenAITokenResponse> {
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

  return response.json() as Promise<OpenAITokenResponse>;
}

function extractAccountId(tokens: OpenAITokenResponse): string | undefined {
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
 * OpenAI OAuth service
 *
 * Provides device authorization and token refresh functionality.
 */
export class OpenAIOAuthService {
  static async initiateDeviceCode(): Promise<OpenAIDeviceCode> {
    const response = await fetch(`${DEVICE_API_ENDPOINT}/usercode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });

    if (!response.ok) {
      throw new Error(`ChatGPT device authorization failed: ${response.status}`);
    }

    const result = (await response.json()) as {
      device_auth_id?: string;
      user_code?: string;
      usercode?: string;
      interval?: number | string;
    };
    const userCode = result.user_code ?? result.usercode;
    if (!result.device_auth_id || !userCode) {
      throw new Error("ChatGPT device authorization returned an invalid response");
    }

    return {
      deviceCode: JSON.stringify({ deviceAuthId: result.device_auth_id, userCode }),
      userCode,
      verificationUri: DEVICE_VERIFICATION_URL,
      interval: Number(result.interval) || 5,
      expiresIn: 15 * 60,
    };
  }

  static async pollDeviceCode(deviceCode: string): Promise<OpenAIOAuthResult | null> {
    const device = JSON.parse(deviceCode) as { deviceAuthId?: string; userCode?: string };
    if (!device.deviceAuthId || !device.userCode) throw new Error("Invalid device code");

    const response = await fetch(`${DEVICE_API_ENDPOINT}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode }),
    });

    if ([403, 404, 429].includes(response.status)) return null;
    if (!response.ok) throw new Error(`ChatGPT authorization failed: ${response.status}`);

    const authorization = (await response.json()) as {
      authorization_code?: string;
      code_verifier?: string;
    };
    if (!authorization.authorization_code || !authorization.code_verifier) return null;

    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: authorization.authorization_code,
        code_verifier: authorization.code_verifier,
        redirect_uri: DEVICE_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok)
      throw new Error(`ChatGPT token exchange failed: ${tokenResponse.status}`);

    const tokens = (await tokenResponse.json()) as OpenAITokenResponse;
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId: extractAccountId(tokens),
    };
  }

  /**
   * Refresh an access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns New tokens
   */
  static async refreshToken(refreshToken: string): Promise<OpenAIOAuthResult> {
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
    return "openai-oauth";
  }
}
