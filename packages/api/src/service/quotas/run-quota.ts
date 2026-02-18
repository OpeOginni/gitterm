import { db, eq } from "@gitterm/db";
import { userLoopRunQuota, userLoopRunEvent } from "@gitterm/db/schema/agent-loop";
import { TRPCError } from "@trpc/server";
import { logger } from "../../utils/logger";

export interface DeductRunResult {
  success: boolean;
  halted?: boolean; // True if run should be halted due to quota issues
  errorMessage?: string;
}

/**
 * Deduct a run from user's quota and record the event
 * Uses a transaction to ensure atomicity
 *
 * @returns Result indicating success or if the run should be halted
 */
export async function deductRunFromQuota(
  userId: string,
  loopId: string,
  runId: string,
  options?: {
    /** If true, marks run as halted instead of throwing error when quota exhausted */
    haltOnExhaustion?: boolean;
    /** If true, allows graceful degradation when quota not found */
    allowMissingQuota?: boolean;
  },
): Promise<DeductRunResult> {
  const { haltOnExhaustion = false, allowMissingQuota = false } = options || {};

  try {
    const result = await db.transaction(async (tx) => {
      // Get current quota
      const [quota] = await tx
        .select()
        .from(userLoopRunQuota)
        .where(eq(userLoopRunQuota.userId, userId));

      if (!quota) {
        if (allowMissingQuota) {
          logger.warn("No quota found for user when deducting run", {
            action: "quota_deduction_missing_quota",
            userId,
            loopId,
            runId,
          });
          return {
            success: false,
            halted: haltOnExhaustion,
            errorMessage: "No quota configuration found. Please contact support.",
          };
        }
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No quota found for user",
        });
      }

      // Check if user has enough runs
      const availableRuns = quota.monthlyRuns + quota.extraRuns;
      if (availableRuns < 1) {
        const errorMessage =
          "Not enough runs available. Please purchase more runs or upgrade your plan.";

        if (haltOnExhaustion) {
          logger.warn("User quota exhausted when deducting run", {
            action: "quota_deduction_exhausted",
            userId,
            loopId,
            runId,
          });
          return {
            success: false,
            halted: true,
            errorMessage,
          };
        }

        throw new TRPCError({
          code: "FORBIDDEN",
          message: errorMessage,
        });
      }

      // Deduct from monthlyRuns first, then extraRuns
      let newMonthlyRuns = quota.monthlyRuns;
      let newExtraRuns = quota.extraRuns;

      if (quota.monthlyRuns > 0) {
        newMonthlyRuns = quota.monthlyRuns - 1;
      } else {
        newExtraRuns = quota.extraRuns - 1;
      }

      // Update quota
      await tx
        .update(userLoopRunQuota)
        .set({
          monthlyRuns: newMonthlyRuns,
          extraRuns: newExtraRuns,
          updatedAt: new Date(),
        })
        .where(eq(userLoopRunQuota.userId, userId));

      // Record the event
      await tx.insert(userLoopRunEvent).values({
        userId,
        loopId,
        runId,
        runsUsed: 1,
        runsAdded: 0,
      });

      return { success: true };
    });

    return result;
  } catch (error) {
    // If it's a TRPCError, rethrow it
    if (error instanceof TRPCError) {
      throw error;
    }

    // For other errors, log and return failure
    logger.error("Failed to deduct quota for run", {
      action: "quota_deduction_failed",
      userId,
      loopId,
      runId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    if (haltOnExhaustion) {
      return {
        success: false,
        halted: true,
        errorMessage: "Failed to process run payment. Please contact support.",
      };
    }

    throw error;
  }
}

/**
 * Refund a run to user's quota (when run fails to start)
 * Uses a transaction to ensure atomicity
 */
export async function refundRunToQuota(
  userId: string,
  loopId: string,
  runId: string,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Get current quota
      const [quota] = await tx
        .select()
        .from(userLoopRunQuota)
        .where(eq(userLoopRunQuota.userId, userId));

      if (!quota) {
        // If no quota exists, just log and return (graceful degradation)
        logger.warn("No quota found when refunding run", {
          action: "quota_refund_missing_quota",
          userId,
          loopId,
          runId,
        });
        return;
      }

      // Refund to extraRuns (since we deducted from monthlyRuns first, refunding to extraRuns is safer)
      await tx
        .update(userLoopRunQuota)
        .set({
          extraRuns: quota.extraRuns + 1,
          updatedAt: new Date(),
        })
        .where(eq(userLoopRunQuota.userId, userId));

      // Record the refund event
      await tx.insert(userLoopRunEvent).values({
        userId,
        loopId,
        runId,
        runsUsed: 0,
        runsAdded: 1, // Refund
      });
    });
  } catch (error) {
    logger.error("Failed to refund quota for run", {
      action: "quota_refund_failed",
      userId,
      loopId,
      runId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    // Don't throw - refund failures shouldn't break the flow
  }
}

/**
 * Check if user has available runs
 */
export async function hasAvailableRuns(userId: string): Promise<boolean> {
  const [quota] = await db
    .select()
    .from(userLoopRunQuota)
    .where(eq(userLoopRunQuota.userId, userId));

  if (!quota) {
    return false;
  }

  return quota.monthlyRuns + quota.extraRuns > 0;
}
