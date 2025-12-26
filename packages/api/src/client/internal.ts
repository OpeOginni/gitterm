import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../routers/index";
import env from "@gitterm/env/server";

const SERVER_URL = env.SERVER_URL || "http://localhost:3000";
const INTERNAL_API_KEY = env.INTERNAL_API_KEY;

if (!INTERNAL_API_KEY) {
  console.warn("[internal-client] INTERNAL_API_KEY not set - internal API calls will fail");
}

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

/**
 * Create an internal client with custom configuration
 */
export function createInternalClient(options?: {
  serverUrl?: string;
  apiKey?: string;
}) {
  const url = options?.serverUrl || SERVER_URL;
  const key = options?.apiKey || INTERNAL_API_KEY;

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${url}/trpc`,
        headers: () => ({
          "x-internal-key": key || "",
        }),
      }),
    ],
  });
}

