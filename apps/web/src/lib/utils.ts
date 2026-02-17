import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import env from "@gitterm/env/web";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Workspace URL Utilities
 *
 * URLs are constructed from subdomain based on routing mode.
 * The backend handles proxying to the actual upstream.
 */

function getProtocolForBaseDomain(baseDomain: string): "http" | "https" {
  // local dev: "localhost:8888" or "127.0.0.1:8888"
  if (baseDomain.includes("localhost") || baseDomain.includes("127.0.0.1")) return "http";
  return "https";
}

/**
 * Construct a workspace URL from subdomain
 */
export function getWorkspaceUrl(subdomain: string): string {
  const protocol = getProtocolForBaseDomain(env.NEXT_PUBLIC_BASE_DOMAIN);
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${protocol}://${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${subdomain}`;
  }

  return `${protocol}://${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}

/**
 * Construct a workspace open port URL from subdomain and port
 */
export function getWorkspaceOpenPortUrl(subdomain: string, port: number): string {
  const protocol = getProtocolForBaseDomain(env.NEXT_PUBLIC_BASE_DOMAIN);
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${protocol}://${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${port}-${subdomain}`;
  }
  return `${protocol}://${port}-${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}

/**
 * Construct the opencode attach command
 */
export function getAttachCommand(subdomain: string, agentName: string): string {
  const url = getWorkspaceUrl(subdomain);

  // TODO: Better agent name detection
  if (agentName.toLocaleLowerCase().includes("opencode")) {
    return `opencode attach ${url}`;
  }
  if (agentName.toLocaleLowerCase().includes("shuvcode")) {
    return `shuvcode attach ${url}`;
  }

  return `opencode attach ${url}`;
}

/**
 * Get display text for a workspace URL
 * Shows the URL without protocol for cleaner display
 */
export function getWorkspaceDisplayUrl(subdomain: string): string {
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${subdomain}`;
  }

  return `${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}