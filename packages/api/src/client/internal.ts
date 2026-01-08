import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../routers/index";

/**
 * Create an internal tRPC client for service-to-service communication
 * Uses INTERNAL_API_KEY for authentication
 *
 * @param serverUrl - The server URL (e.g., http://localhost:3000)
 * @param apiKey - The internal API key
 */
export function createInternalClient(serverUrl: string, apiKey: string) {
  if (!apiKey) {
    console.warn("[internal-client] INTERNAL_API_KEY not set - internal API calls will fail");
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${serverUrl}/trpc`,
        headers: () => ({
          "x-internal-key": apiKey || "",
        }),
      }),
    ],
  });
}

// For backward compatibility: try to load from server env if available
let _internalClient: ReturnType<typeof createInternalClient> | null = null;

/**
 * Get the default internal client (configured from server env)
 * Only works when running in a context with @gitterm/env/server available
 */
export function getInternalClient() {
  if (!_internalClient) {
    // Lazy load to avoid issues when env is not available
    try {
      // Dynamic import would be better but causes issues with tRPC types
      const serverUrl = process.env.SERVER_URL || "http://localhost:3000";
      const apiKey = process.env.INTERNAL_API_KEY || "";
      _internalClient = createInternalClient(serverUrl, apiKey);
    } catch {
      throw new Error("Failed to create internal client - SERVER_URL or INTERNAL_API_KEY not set");
    }
  }
  return _internalClient;
}

/**
 * @deprecated Use createInternalClient() or getInternalClient() instead
 */
export const internalClient = {
  get internal() {
    return getInternalClient().internal;
  },
};
