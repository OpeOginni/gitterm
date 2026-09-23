/**
 * OpenCode console device authorization.
 *
 * Mirrors OpenCode's built-in `opencode` integration so the stored credential
 * can be imported as-is: OpenCode reads `server` and `orgID` from the metadata
 * to load the account's Zen and Go providers, and refreshes the token itself.
 */

const SERVER = "https://opencode.ai/console";
const CLIENT_ID = "opencode-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface OpencodeConsoleDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export interface OpencodeConsoleOAuthResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  metadata: Record<string, string>;
}

type TokenResponse =
  | { access_token: string; refresh_token: string; expires_in: number; org_id?: string | null }
  | { error: string };

async function post(path: string, body: Record<string, string | boolean>) {
  return fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
}

async function get<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`OpenCode console request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export const OpencodeConsoleOAuthService = {
  async initiateDeviceCode(): Promise<OpencodeConsoleDeviceCode> {
    const response = await post("/auth/device/code", {
      client_id: CLIENT_ID,
      supports_org_scope: true,
    });
    if (!response.ok) {
      throw new Error(`OpenCode device authorization failed: ${response.status}`);
    }
    const device = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
    };
    if (!device.device_code || !device.user_code || !device.verification_uri_complete) {
      throw new Error("OpenCode device authorization returned an invalid response");
    }
    const verification = new URL(device.verification_uri_complete, `${SERVER}/`);
    if (verification.protocol !== "https:") {
      throw new Error("OpenCode device authorization returned an invalid verification URL");
    }
    return {
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUri: verification.href,
      interval: device.interval || 5,
      expiresIn: device.expires_in || 600,
    };
  },

  /** Returns null while the user has not approved yet; "slow_down" asks the caller to back off. */
  async pollDeviceCode(
    deviceCode: string,
  ): Promise<OpencodeConsoleOAuthResult | null | "slow_down"> {
    const response = await post("/auth/device/token", {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
      client_id: CLIENT_ID,
    });
    const result = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!("access_token" in result)) {
      const error = "error" in result ? result.error : `status ${response.status}`;
      if (error === "authorization_pending") return null;
      if (error === "slow_down") return "slow_down";
      throw new Error(`OpenCode authorization failed: ${error}`);
    }

    const [user, orgs] = await Promise.all([
      get<{ id: string; email: string }>("/api/user", result.access_token),
      get<Array<{ id: string; name: string }>>("/api/orgs", result.access_token),
    ]);
    const org =
      result.org_id == null
        ? orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
        : orgs.find((candidate) => candidate.id === result.org_id);
    if (result.org_id != null && !org) {
      throw new Error("OpenCode organization not found for this account");
    }

    return {
      refreshToken: result.refresh_token,
      accessToken: result.access_token,
      expiresAt: Date.now() + result.expires_in * 1000,
      metadata: {
        server: SERVER,
        accountID: user.id,
        email: user.email,
        ...(org ? { orgID: org.id, orgName: org.name } : {}),
      },
    };
  },
};
