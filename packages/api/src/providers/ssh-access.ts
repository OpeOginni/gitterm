import type { CloudProvidersshAccessSupport } from "@gitterm/db/schema/cloud";

export const WORKSPACE_PROFILES = ["standard", "ssh-enabled"] as const;
export type WorkspaceProfile = (typeof WORKSPACE_PROFILES)[number];

export const EDITOR_TARGETS = ["vscode", "neovim"] as const;
export type EditorTarget = (typeof EDITOR_TARGETS)[number];

export const EDITOR_TRANSPORT_KINDS = ["direct-ssh", "proxycommand-ssh", "managed-ssh"] as const;
export type EditorTransportKind = (typeof EDITOR_TRANSPORT_KINDS)[number];

export interface ProvidersshAccessSupport {
  supported: boolean;
  transportKind?: EditorTransportKind;
  label: string;
  description: string;
  requiresLocalBinaries?: string[];
}

export interface WorkspaceSSHAccessConfig {
  workspaceId: string;
  userId: string;
  externalServiceId: string;
  subdomain: string;
  projectPathHint: string;
  regionIdentifier?: string;
  existingConnection?: WorkspaceSSHConnection;
}

export interface WorkspaceSSHConnection {
  transportKind: EditorTransportKind;
  host: string;
  port: number;
  /**
   * Non-secret provider resource handle used to tear down access later
   * (e.g. a Railway TCP proxy id). Safe to store in plaintext.
   */
  externalConnectionId?: string;
  /**
   * Encrypted secret required to revoke access later (e.g. a Daytona SSH
   * access token). Providers that need a credential to revoke MUST encrypt it
   * before placing it here; it is never persisted in plaintext.
   */
  revocationToken?: string;
  /** ISO timestamp for short-lived provider credentials. */
  expiresAt?: string;
}

export interface WorkspaceSSHAccessCleanupConfig {
  workspaceId: string;
  externalServiceId: string;
  connection: WorkspaceSSHConnection;
  regionIdentifier?: string;
}

export interface WorkspaceSSHAccess {
  providerName: string;
  transportKind: EditorTransportKind;
  hostAlias: string;
  host: string;
  port: number;
  user: string;
  sshConnectionString: string;
  sshCommand: string;
  sshConfigSnippet: string;
  projectPathHint: string;
  expiresAt?: string;
  requiredLocalBinaries?: string[];
  notes: string[];
  connection?: WorkspaceSSHConnection;
}

export function normalizeProvidersshAccessSupport(
  value?: CloudProvidersshAccessSupport | null,
): ProvidersshAccessSupport {
  return {
    supported: value?.supported === true,
    transportKind: value?.transportKind,
    label: value?.label ?? "Not supported",
    description: value?.description ?? "This provider does not currently expose editor SSH access.",
    requiresLocalBinaries: value?.requiresLocalBinaries,
  };
}

export function isEditorReadyImageName(name: string, imageId?: string): boolean {
  const haystack = `${name} ${imageId ?? ""}`.toLowerCase();
  return (
    haystack.includes("with-ssh") || haystack.includes("ssh-enabled") || haystack.includes("-ssh")
  );
}

export function pickWorkspaceImage<
  T extends {
    name: string;
    imageId: string;
    providerMetadata?: { isDefault?: boolean } | null;
  },
>(images: T[], _profile: WorkspaceProfile): T | undefined {
  if (images.length === 0) {
    return undefined;
  }

  return images.find((img) => img.providerMetadata?.isDefault === true) ?? images[0];
}

export function buildHostAlias(subdomain: string): string {
  return `gitterm-${subdomain}`;
}

export function buildStandardSshConfigSnippet(options: {
  hostAlias: string;
  host: string;
  port: number;
  user: string;
  proxyCommand?: string;
}): string {
  const lines = [
    `Host ${options.hostAlias}`,
    `  HostName ${options.host}`,
    `  User ${options.user}`,
    `  Port ${options.port}`,
  ];

  if (options.proxyCommand) {
    lines.push(`  ProxyCommand ${options.proxyCommand}`);
  }

  lines.push("  ServerAliveInterval 30", "  ServerAliveCountMax 6");
  return lines.join("\n");
}

export function buildSshCommand(options: {
  host: string;
  port: number;
  user: string;
  proxyCommand?: string;
}): string {
  const args = ["ssh"];

  if (options.proxyCommand) {
    args.push(`-o ProxyCommand='${options.proxyCommand}'`);
  }

  if (options.port !== 22) {
    args.push(`-p ${options.port}`);
  }

  args.push(`${options.user}@${options.host}`);
  return args.join(" ");
}

export function buildSshConnectionString(options: {
  host: string;
  port: number;
  user: string;
}): string {
  if (options.port === 22) {
    return `${options.user}@${options.host}`;
  }

  return `${options.user}@${options.host}:${options.port}`;
}

export function buildProjectPathHint(repositoryUrl?: string | null): string {
  const repoName = repositoryUrl
    ?.replace(/\/+$/, "")
    .split("/")
    .pop()
    ?.replace(/\.git$/i, "");
  return repoName ? `/workspace/${repoName}` : "/workspace";
}
