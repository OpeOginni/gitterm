import { cliJWT } from "./cli-jwt";
import { DeviceCodeRepository } from "@gitterm/redis";

export class CLIAutheService {
  private deviceRepo = new DeviceCodeRepository();

  async exchangeDeviceCode(deviceCode: string): Promise<{ cliToken: string } | null> {
    const consumed = await this.deviceRepo.consumeApprovedDeviceCode(deviceCode);
    if (!consumed) return null;
    return { cliToken: cliJWT.generateToken({ userId: consumed.userId }) };
  }

}
