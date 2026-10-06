import { getBilling } from "../billing";
import { getIdleTimeoutMinutes } from "./config/system-config";

/**
 * Provider lease for always-on workspaces. The worker renews it every pass
 * (about every 10 minutes), so it only needs to outlast a few missed passes.
 */
export const ALWAYS_ON_LEASE_MS = 60 * 60 * 1_000;

export async function getWorkspaceIdleTimeoutMs(userId: string, alwaysOn = false): Promise<number> {
  const entitlements = await (await getBilling()).getEntitlements(userId);
  if (alwaysOn && entitlements.alwaysOn) return ALWAYS_ON_LEASE_MS;
  const timeoutMinutes = entitlements.idleTimeoutMinutes ?? (await getIdleTimeoutMinutes());

  return timeoutMinutes * 60 * 1_000;
}
