import { isUnexpectedError, sanitizeExceptionProperties } from "./errors";

interface ServerErrorConfig {
  enabled: boolean;
  key?: string;
  host?: string;
}

/** Explicit operational opt-in. No user identity, cookies, request bodies, or raw messages. */
export function createServerErrorTracking(config: ServerErrorConfig) {
  let client: Promise<import("posthog-node").PostHog> | undefined;
  return {
    async captureException(error: unknown) {
      if (!config.enabled || !config.key || !config.host || !isUnexpectedError(error)) return;
      try {
        client ??= import("posthog-node")
          .then(
            ({ PostHog }) =>
              new PostHog(config.key!, {
                host: config.host,
                enableExceptionAutocapture: false,
                disableGeoip: true,
                flushAt: 1,
                flushInterval: 0,
                requestTimeout: 2_000,
                fetchRetryCount: 0,
                before_send: (event) => {
                  if (!event || event.event !== "$exception") return null;
                  const properties = sanitizeExceptionProperties(event.properties ?? {});
                  return properties ? { ...event, properties } : null;
                },
              }),
          )
          .catch((initializationError: unknown) => {
            client = undefined;
            throw initializationError;
          });
        const posthog = await client;
        posthog.captureException(error, "service:server", {
          service: "server",
          schema_version: 2,
          $process_person_profile: false,
        });
        await posthog.flush();
      } catch {
        // Logging/reporting failures never propagate into request handling.
      }
    },
  };
}
