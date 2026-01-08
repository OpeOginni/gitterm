import { randomBytes } from "crypto";
import { getRedisClient } from "../client";
import { RedisKeys } from "../keys";

const DEVICE_CODE_TTL_SECONDS = 60 * 10; // 10 minutes

export type DeviceCodeState = "pending" | "approved" | "denied" | "expired";

export interface DeviceCodeSession {
  deviceCode: string;
  userCode: string;
  createdAt: number;
  status: DeviceCodeState;
  userId?: string;
  // Optional metadata for UX
  clientName?: string;
}

function base32Alphabet(): string {
  // Crockford-like base32 without confusing chars.
  return "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
}

function generateUserCode(): string {
  const alphabet = base32Alphabet();
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out.slice(0, 4) + "-" + out.slice(4, 8);
}

function generateDeviceCode(): string {
  return randomBytes(24).toString("hex");
}

export class DeviceCodeRepository {
  private redis = getRedisClient();

  async createSession(params?: { clientName?: string }): Promise<DeviceCodeSession> {
    const createdAt = Date.now();

    // Ensure userCode is unique.
    let userCode = generateUserCode();
    for (let i = 0; i < 5; i++) {
      const exists = await this.redis.exists(RedisKeys.userCode(userCode));
      if (!exists) break;
      userCode = generateUserCode();
    }

    const deviceCode = generateDeviceCode();
    const session: DeviceCodeSession = {
      deviceCode,
      userCode,
      createdAt,
      status: "pending",
      clientName: params?.clientName,
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(RedisKeys.deviceCode(deviceCode), {
      deviceCode,
      userCode,
      createdAt: String(createdAt),
      status: "pending",
      clientName: params?.clientName ?? "",
    });
    pipeline.expire(RedisKeys.deviceCode(deviceCode), DEVICE_CODE_TTL_SECONDS);

    pipeline.set(RedisKeys.userCode(userCode), deviceCode);
    pipeline.expire(RedisKeys.userCode(userCode), DEVICE_CODE_TTL_SECONDS);

    await pipeline.exec();
    return session;
  }

  async getByUserCode(userCode: string): Promise<DeviceCodeSession | null> {
    const deviceCode = await this.redis.get(RedisKeys.userCode(userCode));
    if (!deviceCode) return null;
    return this.getByDeviceCode(deviceCode);
  }

  async getByDeviceCode(deviceCode: string): Promise<DeviceCodeSession | null> {
    const data = await this.redis.hgetall(RedisKeys.deviceCode(deviceCode));
    if (!data.deviceCode || !data.userCode || !data.createdAt || !data.status) return null;

    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      createdAt: Number.parseInt(data.createdAt, 10),
      status: data.status as DeviceCodeState,
      userId: data.userId || undefined,
      clientName: data.clientName || undefined,
    };
  }

  async approve(params: { userCode: string; userId: string }) {
    const session = await this.getByUserCode(params.userCode);
    if (!session) return false;
    if (session.status !== "pending") return false;

    await this.redis.hset(RedisKeys.deviceCode(session.deviceCode), {
      status: "approved",
      userId: params.userId,
    });
    return true;
  }

  async deny(params: { userCode: string }) {
    const session = await this.getByUserCode(params.userCode);
    if (!session) return false;
    if (session.status !== "pending") return false;

    await this.redis.hset(RedisKeys.deviceCode(session.deviceCode), {
      status: "denied",
    });
    return true;
  }

  async consumeApprovedDeviceCode(deviceCode: string): Promise<{ userId: string } | null> {
    const session = await this.getByDeviceCode(deviceCode);
    if (!session) return null;
    if (session.status !== "approved" || !session.userId) return null;

    // One-time consume.
    const pipeline = this.redis.pipeline();
    pipeline.del(RedisKeys.deviceCode(deviceCode));
    pipeline.del(RedisKeys.userCode(session.userCode));
    await pipeline.exec();

    return { userId: session.userId };
  }
}
