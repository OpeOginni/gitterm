import { DeviceCodeRepository } from "@gitpad/redis";
import type { DeviceCodeState } from "@gitpad/redis";

const DEFAULT_POLL_INTERVAL_SECONDS = 5;

export class DeviceCodeService {
	private repo = new DeviceCodeRepository();

	async startDeviceLogin(params?: { clientName?: string }) {
		const session = await this.repo.createSession({ clientName: params?.clientName });
		return {
			deviceCode: session.deviceCode,
			userCode: session.userCode,
			verificationUri: process.env.DEVICE_CODE_VERIFICATION_URI || "https://gitterm.dev/device",
			intervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
			expiresInSeconds: 10 * 60,
		};
	}

	async poll(deviceCode: string): Promise<{ status: DeviceCodeState; userId?: string }> {
		const session = await this.repo.getByDeviceCode(deviceCode);
		if (!session) return { status: "expired" };
		return { status: session.status, userId: session.userId };
	}
}
