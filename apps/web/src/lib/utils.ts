import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import env from "@gitterm/env/web";

// Point this at app.opencode.ai once the connect route is released there.
export const OPENCODE_CONNECT_WEB_URL = "http://127.0.0.1:4173";

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
export function getAttachCommand(
  subdomain: string,
  agentName: string,
  password?: string | null,
): string {
  const url = getWorkspaceUrl(subdomain);
  const passwordFlag = password ? ` --password ${password}` : "";

  // TODO: Better agent name detection
  if (agentName.toLocaleLowerCase().includes("opencode")) {
    return `opencode attach ${url}${passwordFlag}`;
  }
  if (agentName.toLocaleLowerCase().includes("shuvcode")) {
    return `shuvcode attach ${url}${passwordFlag}`;
  }

  return `opencode attach ${url}${passwordFlag}`;
}

export function isT3Agent(agentName: string): boolean {
  return agentName.trim().toLowerCase().startsWith("t3code");
}

export function isOpencodeAgent(agentName: string): boolean {
  return agentName.trim().toLowerCase().includes("opencode");
}

export function getOpencodeWebConnectUrl(server: string, directory: string): string {
  const params = new URLSearchParams({ server, directory });
  return `${OPENCODE_CONNECT_WEB_URL}/#connect?${params}`;
}

export function getOpencodeDesktopConnectUrl(server: string, directory: string): string {
  const params = new URLSearchParams({ server, directory });
  return `opencode://connect?${params}`;
}

/**
 * In-sandbox path of the cloned repo, for pasting into OpenCode's project
 * picker. Mirrors each provider's workspace layout (see packages/api/src/providers).
 * OpenCode expands `~/`, so E2B's /home/user/workspace is shown as ~/workspace;
 * Daytona's /workspace is not under the home dir and stays absolute.
 */
export function getWorkspaceProjectPath(
  providerKey: string | undefined,
  repositoryUrl?: string | null,
): string {
  const repoName = repositoryUrl
    ?.replace(/\/+$/, "")
    .split("/")
    .pop()
    ?.replace(/\.git$/i, "");
  const base =
    providerKey === "e2b"
      ? "~/workspace"
      : providerKey === "vercel"
        ? "/vercel/sandbox"
        : providerKey === "upstash"
          ? "/workspace/home"
          : providerKey === "ascii"
            ? "/home/user"
            : providerKey === "exedev"
              ? "/home/exedev"
              : "/workspace";
  return repoName ? `${base}/${repoName}` : base;
}

export function getT3PairingUrl(subdomain: string, token: string): string {
  const host = encodeURIComponent(getWorkspaceUrl(subdomain));
  return `https://app.t3.codes/pair?host=${host}#token=${encodeURIComponent(token)}`;
}

export function getT3DesktopPairingUrl(subdomain: string, token: string): string {
  const host = encodeURIComponent(getWorkspaceUrl(subdomain));
  return `t3code://app/pair?host=${host}#token=${encodeURIComponent(token)}`;
}

export function getWorkspaceDisplayUrl(subdomain: string): string {
  if (env.NEXT_PUBLIC_ROUTING_MODE === "path") {
    return `${env.NEXT_PUBLIC_BASE_DOMAIN}/ws/${subdomain}`;
  }

  return `${subdomain}.${env.NEXT_PUBLIC_BASE_DOMAIN}`;
}
