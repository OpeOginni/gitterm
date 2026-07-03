import { DeviceCodeRepository } from "@gitterm/redis";
import env from "@gitterm/env/server";
import { createApiToken } from "../api-token";

const DEFAULT_POLL_INTERVAL_SECONDS = 5;

/** Device-code logins mint a standard revocable API token with this lifetime. */
const DEVICE_LOGIN_TOKEN_EXPIRY_DAYS = 30;

export class DeviceCodeService {
  private repo = new DeviceCodeRepository();

  async startDeviceLogin(params?: { clientName?: string }) {
    const session = await this.repo.createSession({ clientName: params?.clientName });
    return {
      deviceCode: session.deviceCode,
      userCode: session.userCode,
      verificationUri: env.DEVICE_CODE_VERIFICATION_URI || "https://gitterm.dev/device",
      intervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
      expiresInSeconds: 10 * 60,
    };
  }

  /**
   * Exchange an approved device code for a user API token (`gt_...`).
   * The token is identical to one created from the dashboard: DB-backed,
   * revocable from Settings -> Account -> API tokens.
   */
  async exchangeDeviceCode(deviceCode: string): Promise<{
    token: string;
    expiresInSeconds: number;
  } | null> {
    const consumed = await this.repo.consumeApprovedDeviceCode(deviceCode);
    if (!consumed) return null;

    const { token } = await createApiToken({
      userId: consumed.userId,
      name: "CLI device login",
      expiresInDays: DEVICE_LOGIN_TOKEN_EXPIRY_DAYS,
    });

    return {
      token,
      expiresInSeconds: DEVICE_LOGIN_TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
    };
  }
}
