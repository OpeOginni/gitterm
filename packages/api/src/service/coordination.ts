import { CoordinationRepository } from "@gitterm/redis";
import { TRPCError } from "@trpc/server";

/** Never silently become a sole bot replica or disable rate limits when Redis is down. */
export async function coordinate<T>(
  operation: (repository: CoordinationRepository) => Promise<T>,
): Promise<T> {
  try {
    return await operation(new CoordinationRepository());
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Coordination is unavailable. Restore Redis before retrying.",
    });
  }
}
