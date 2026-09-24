import { z } from "zod";

/**
 * `private`: only the workspace owner's signed-in GitTerm browser session can reach the URL.
 * `public`: anyone with the URL can reach it (APIs, webhooks, demos).
 */
export const portVisibilitySchema = z.enum(["private", "public"]);
export type PortVisibility = z.infer<typeof portVisibilitySchema>;

export const DEFAULT_PORT_VISIBILITY: PortVisibility = "private";

export type ExposedPort = {
  port: number;
  name?: string;
  upstreamUrl?: string;
  externalPortDomainId?: string;
  /** Missing on ports opened before visibility existed; treated as private. */
  visibility?: PortVisibility;
};

export function getPortVisibility(port: Pick<ExposedPort, "visibility"> | null | undefined) {
  return port?.visibility ?? DEFAULT_PORT_VISIBILITY;
}
