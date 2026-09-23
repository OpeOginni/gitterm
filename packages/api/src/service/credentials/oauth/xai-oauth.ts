/**
 * xAI (SuperGrok) device authorization.
 *
 * Uses the same public client as OpenCode's built-in `xai` device method, so the
 * imported credential refreshes inside the workspace without GitTerm.
 */

const ISSUER = "https://auth.x.ai/oauth2";
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface XaiDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export interface XaiOAuthResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
  };
}

function expiresAt(accessToken: string, expiresIn: number | undefined): number {
  if (expiresIn && expiresIn > 0) return Date.now() + expiresIn * 1000;
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString());
    if (typeof claims.exp === "number") return claims.exp * 1000;
  } catch {
    // Opaque token; fall through to the default lifetime.
  }
  return Date.now() + 3600 * 1000;
}

export const XaiOAuthService = {
  async initiateDeviceCode(): Promise<XaiDeviceCode> {
    const response = await fetch(
      `${ISSUER}/device/code`,
      form({ client_id: CLIENT_ID, scope: SCOPE, referrer: "opencode" }),
    );
    if (!response.ok) throw new Error(`xAI device authorization failed: ${response.status}`);
    const device = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
    };
    const verificationUri = device.verification_uri_complete ?? device.verification_uri;
    if (!device.device_code || !device.user_code || !verificationUri) {
      throw new Error("xAI device authorization returned an invalid response");
    }
    return {
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUri,
      interval: device.interval || 5,
      expiresIn: device.expires_in || 300,
    };
  },

  /** Returns null while the user has not approved yet; "slow_down" asks the caller to back off. */
  async pollDeviceCode(deviceCode: string): Promise<XaiOAuthResult | null | "slow_down"> {
    const response = await fetch(
      `${ISSUER}/token`,
      form({ grant_type: DEVICE_GRANT, client_id: CLIENT_ID, device_code: deviceCode }),
    );
    const result = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (response.ok && result.access_token) {
      if (!result.refresh_token) throw new Error("xAI did not return a refresh token");
      return {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: expiresAt(result.access_token, result.expires_in),
      };
    }
    if (result.error === "authorization_pending") return null;
    if (result.error === "slow_down") return "slow_down";
    if (result.error === "access_denied" || result.error === "authorization_denied") {
      throw new Error("xAI authorization was denied");
    }
    if (result.error === "expired_token") throw new Error("xAI device code expired");
    throw new Error(
      `xAI authorization failed: ${result.error_description ?? result.error ?? response.status}`,
    );
  },
};
