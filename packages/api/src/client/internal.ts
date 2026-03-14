import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../routers/index";
import env from "@gitterm/env/listener";

type InternalClientExtraHeaders = Record<string, string | undefined>;

export function createInternalClient(
  serverUrl: string,
  apiKey: string,
  extraHeaders?: InternalClientExtraHeaders,
) {
  if (!apiKey) {
    console.warn("[internal-client] INTERNAL_API_KEY not set - internal API calls will fail");
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${serverUrl}/trpc`,
        headers: () => {
          const baseHeaders: Record<string, string> = {
            "x-internal-key": apiKey || "",
          };

          if (!extraHeaders) {
            return baseHeaders;
          }

          for (const [key, value] of Object.entries(extraHeaders)) {
            if (value !== undefined) {
              baseHeaders[key] = value;
            }
          }

          return baseHeaders;
        },
      }),
    ],
  });
}

// For backward compatibility: try to load from server env if available
let _internalClient: ReturnType<typeof createInternalClient> | null = null;

export function getInternalClient(extraHeaders?: InternalClientExtraHeaders) {
  if (extraHeaders) {
    const serverUrl = env.SERVER_URL || "http://localhost:3000";
    const apiKey = env.INTERNAL_API_KEY || "";
    return createInternalClient(serverUrl, apiKey, extraHeaders);
  }

  if (!_internalClient) {
    try {
      const serverUrl = env.SERVER_URL || "http://localhost:3000";
      const apiKey = env.INTERNAL_API_KEY || "";
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
