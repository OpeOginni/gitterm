/**
 * GitHub Copilot OAuth Service
 *
 * Implements the Device Code OAuth flow for GitHub Copilot authentication.
 * Based on the OpenCode CopilotAuthPlugin pattern.
 *
 * Flow:
 * 1. Request device code from GitHub
 * 2. User visits verification URL and enters code
 * 3. Poll for access token
 * 4. Exchange access token for Copilot API token
 * 5. Store refresh token (GitHub OAuth token) for future use
 */

const CLIENT_ID = "Iv1.b507a08c87ecfe98";

const HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};

/**
 * Normalize a domain by removing protocol and trailing slash
 */
function normalizeDomain(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Get OAuth URLs for a given GitHub domain
 */
function getUrls(domain: string = "github.com") {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

/**
 * Get the Copilot API base URL for a domain
 */
export function getCopilotBaseUrl(enterpriseUrl?: string): string {
  if (enterpriseUrl) {
    const domain = normalizeDomain(enterpriseUrl);
    return `https://copilot-api.${domain}`;
  }
  return "https://api.githubcopilot.com";
}

export interface DeviceCodeResponse {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
}

export interface TokenResponse {
  success: boolean;
  accessToken?: string;
  error?: string;
}

export interface CopilotTokenResponse {
  token: string;
  expiresAt: number; // Unix timestamp in seconds
}

/**
 * GitHub Copilot OAuth Service
 */
export class GitHubCopilotOAuthService {
  /**
   * Initiate the device code flow.
   * Returns the verification URI and user code for the user to enter.
   *
   * @param enterpriseUrl - Optional GitHub Enterprise URL
   * @returns Device code response with verification details
   */
  static async initiateDeviceCode(enterpriseUrl?: string): Promise<DeviceCodeResponse> {
    const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com";
    const urls = getUrls(domain);

    const response = await fetch(urls.deviceCodeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": HEADERS["User-Agent"],
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        scope: "read:user",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to initiate device authorization: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      verification_uri: string;
      user_code: string;
      device_code: string;
      interval?: number;
      expires_in?: number;
    };

    return {
      verificationUri: data.verification_uri,
      userCode: data.user_code,
      deviceCode: data.device_code,
      interval: data.interval || 5,
      expiresIn: data.expires_in || 900,
    };
  }

  /**
   * Poll for the access token after user has authorized.
   * This should be called repeatedly with the interval from initiateDeviceCode.
   *
   * @param deviceCode - The device code from initiateDeviceCode
   * @param enterpriseUrl - Optional GitHub Enterprise URL
   * @returns Token response (success with accessToken, or error)
   */
  static async pollForToken(deviceCode: string, enterpriseUrl?: string): Promise<TokenResponse> {
    const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com";
    const urls = getUrls(domain);

    const response = await fetch(urls.accessTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": HEADERS["User-Agent"],
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
    };

    if (data.access_token) {
      return { success: true, accessToken: data.access_token };
    }

    if (data.error === "authorization_pending") {
      return { success: false, error: "authorization_pending" };
    }

    if (data.error === "slow_down") {
      return { success: false, error: "slow_down" };
    }

    if (data.error === "expired_token") {
      return { success: false, error: "expired_token" };
    }

    if (data.error === "access_denied") {
      return { success: false, error: "access_denied" };
    }

    return { success: false, error: data.error || "unknown_error" };
  }

  /**
   * Exchange a GitHub OAuth token for a Copilot API token.
   * This is the "refresh" operation - the GitHub OAuth token is long-lived,
   * and we use it to get short-lived Copilot API tokens.
   *
   * @param refreshToken - The GitHub OAuth access token (stored as refresh)
   * @param enterpriseUrl - Optional GitHub Enterprise URL
   * @returns Copilot API token and expiry
   */
  static async refreshCopilotToken(
    refreshToken: string,
    enterpriseUrl?: string,
  ): Promise<CopilotTokenResponse> {
    const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com";
    const urls = getUrls(domain);

    const response = await fetch(urls.copilotTokenUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${refreshToken}`,
        ...HEADERS,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to refresh Copilot token: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      token: string;
      expires_at: number;
    };

    return {
      token: data.token,
      expiresAt: data.expires_at, // Unix timestamp in seconds
    };
  }

  /**
   * Complete the full device code flow by polling until success or timeout.
   *
   * @param deviceCode - The device code from initiateDeviceCode
   * @param interval - Polling interval in seconds
   * @param timeout - Maximum time to wait in seconds
   * @param enterpriseUrl - Optional GitHub Enterprise URL
   * @returns The access token if successful
   */
  static async waitForAuthorization(
    deviceCode: string,
    interval: number = 5,
    timeout: number = 900,
    enterpriseUrl?: string,
  ): Promise<string> {
    const startTime = Date.now();
    let currentInterval = interval * 1000;

    while (Date.now() - startTime < timeout * 1000) {
      const result = await this.pollForToken(deviceCode, enterpriseUrl);

      if (result.success && result.accessToken) {
        return result.accessToken;
      }

      if (result.error === "authorization_pending") {
        await new Promise((resolve) => setTimeout(resolve, currentInterval));
        continue;
      }

      if (result.error === "slow_down") {
        // Increase interval by 5 seconds as per OAuth spec
        currentInterval += 5000;
        await new Promise((resolve) => setTimeout(resolve, currentInterval));
        continue;
      }

      if (result.error === "expired_token") {
        throw new Error("Device code expired. Please start the authorization process again.");
      }

      if (result.error === "access_denied") {
        throw new Error("Authorization was denied by the user.");
      }

      throw new Error(`Authorization failed: ${result.error}`);
    }

    throw new Error("Authorization timed out. Please try again.");
  }

  /**
   * Get the provider ID - always github-copilot (enterprise uses same provider with enterpriseUrl in oauthConfig).
   */
  static getProviderId(_enterpriseUrl?: string): string {
    return "github-copilot";
  }
}

export const githubCopilotOAuth = GitHubCopilotOAuthService;
