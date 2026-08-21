export interface DaytonaConfig {
  apiKey: string;
  defaultTargetRegion: "us" | "eu";
  webhookSecret?: string;
  /**
   * Whether the Daytona organization is Tier 3+ (unrestricted sandbox
   * network). On Tier 1/2, egress is locked to Daytona's essential-services
   * allowlist and cannot be overridden per sandbox, so workspaces cannot call
   * the gitterm API — setup status is then reconciled by polling instead.
   */
  tier3NetworkAccess?: boolean;
}
