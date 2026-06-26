import { db, eq } from "@gitterm/db";
import { user } from "@gitterm/db/schema/auth";
import {
  getIdleTimeoutMinutesForPlan,
  type UserPlan,
} from "../config/features";
import { getIdleTimeoutMinutes } from "./config/system-config";

export async function getWorkspaceIdleTimeoutMs(userId: string): Promise<number> {
  const [owner] = await db
    .select({ plan: user.plan })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const planTimeout = getIdleTimeoutMinutesForPlan(
    (owner?.plan ?? "free") as UserPlan,
  );
  const timeoutMinutes = planTimeout ?? (await getIdleTimeoutMinutes());

  return timeoutMinutes * 60 * 1_000;
}
