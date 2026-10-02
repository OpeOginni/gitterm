import { z } from "zod";

export const EXECUTOR_MCP_URL =
  "https://v2.executor.sh/org/<organization-id-or-slug>/mcp?elicitation_mode=browser";
export const mcpIntegrationKey = z.enum(["mcp", "executor"]);

export const mcpEndpoint = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const credentialParameters =
      /^(?:api[-_]?key|key|token|access[-_]?token|refresh[-_]?token|authorization|password|secret)$/i;
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !/[<>]/.test(value) &&
      !Array.from(url.searchParams.keys()).some((name) => credentialParameters.test(name))
    );
  }, "Use a complete HTTPS MCP endpoint without credentials, placeholders, or a fragment");

const reservedHeaders =
  /^(host|cookie|set-cookie|connection|content-length|content-type|accept|transfer-encoding|upgrade|proxy-.*|mcp-.*|last-event-id|forwarded|x-forwarded-.*|__proto__|constructor|prototype)$/i;
export const mcpHeaders = z
  .record(
    z
      .string()
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
      .refine(
        (name) => !reservedHeaders.test(name),
        "This header belongs to the transport or uses a reserved name",
      ),
    z
      .string()
      .min(1)
      .max(8192)
      .refine(
        (value) =>
          Array.from(value).every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "Header values must not contain control characters",
      ),
  )
  .refine((headers) => Object.keys(headers).length <= 16, "Use at most 16 headers")
  .refine(
    (headers) =>
      new Set(Object.keys(headers).map((name) => name.toLowerCase())).size ===
      Object.keys(headers).length,
    "Header names must be unique ignoring case",
  );

export const mcpAuthentication = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("headers"),
    headers: mcpHeaders.refine(
      (headers) => Object.keys(headers).length > 0,
      "Add an authentication header",
    ),
  }),
]);

export const mcpConnectionInput = z.object({
  integration: mcpIntegrationKey,
  name: z.string().trim().min(1).max(100),
  url: mcpEndpoint,
  authentication: mcpAuthentication,
  codemode: z.boolean().default(true),
});

export type McpConnectionInput = z.input<typeof mcpConnectionInput>;
export type McpAuthentication = z.infer<typeof mcpAuthentication>;
