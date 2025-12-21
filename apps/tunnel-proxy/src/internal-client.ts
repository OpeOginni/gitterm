import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@gitpad/api";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// Intentionally avoid noisy startup logs; missing key will fail requests.

/**
 * Internal tRPC client for service-to-service communication
 * Uses INTERNAL_API_KEY for authentication
 */
export const internalClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${SERVER_URL}/trpc`,
      headers: () => ({
        "x-internal-key": INTERNAL_API_KEY || "",
      }),
    }),
  ],
});
