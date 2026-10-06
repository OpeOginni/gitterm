import { getBilling } from "../billing";
import { getIdleTimeoutMinutes } from "./config/system-config";

export async function getWorkspaceIdleTimeoutMs(userId: string): Promise<number> {
  const { idleTimeoutMinutes } = await (await getBilling()).getEntitlements(userId);
  const timeoutMinutes = idleTimeoutMinutes ?? (await getIdleTimeoutMinutes());

  return timeoutMinutes * 60 * 1_000;
}
