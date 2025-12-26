import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@gitterm/api";
import env from "@gitterm/env/tunnel-proxy";

const SERVER_URL = env.SERVER_URL || "http://localhost:3000";
const INTERNAL_API_KEY = env.INTERNAL_API_KEY;

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
