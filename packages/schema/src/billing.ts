/**
 * The contract between the open core and billing.
 *
 * Core never knows plan names or prices. It asks billing what a user may use
 * and whether they may run compute now. Self-hosted deployments use the
 * built-in unlimited implementation; managed deployments load `@gitterm/billing`.
 */

/** Which of a provider's machine sizes a user may use: all of them, or only the smallest. */
export type MachineAccess = "any" | "smallest";

/** What a user may use. With billing off, everything is allowed and nothing is reaped. */
export interface Entitlements {
  /** Billing plan id, or null when billing is off. */
  plan: string | null;
  /** Provider keys the user may use; null means every enabled provider. */
  providerKeys: string[] | null;
  machineAccess: MachineAccess;
  /** Most workspaces (running, pending, or paused) the user may keep; null means no limit. */
  maxWorkspaces: number | null;
  /** Whether the user may opt into persistent storage on providers that make it optional. */
  persistence: boolean;
  customSubdomain: boolean;
  /** Whether the user may keep workspaces running while idle. */
  alwaysOn: boolean;
  /** Idle minutes before a workspace pauses; null uses the deployment's idle timeout. */
  idleTimeoutMinutes: number | null;
  /** Days a paused workspace is kept before it is deleted; null keeps it forever. */
  retentionDays: number | null;
}

export type RunAllowance = { allowed: true } | { allowed: false; reason: string };

/** Monthly compute for paid plans. Amounts are in cents. */
export interface ComputeUsage {
  includedCents: number;
  /** Compute used this period at list prices, including workspaces still running. */
  usedCents: number;
  /** What the user owes beyond the included compute, after any plan discount. */
  overageCents: number;
  overageDiscountPercent: number;
  payAsYouGo: boolean;
  /** Most overage the user accepts per period; null when pay-as-you-go is off. */
  spendCapCents: number | null;
  /** usedCents extrapolated to the end of the period. */
  projectedCents: number;
  /** Hourly cost of the workspaces running now. */
  runningCentsPerHour: number;
}

/** Dashboard view of a user's plan. Only returned while billing is on. */
export interface BillingAccount {
  plan: string;
  planName: string;
  priceCents: number;
  /** ISO timestamps of the current billing period. */
  period: { start: string; end: string };
  /** Paid plans: monthly compute balance. */
  compute: ComputeUsage | null;
  /** Free plan: runtime used today and the daily limit (null when unlimited). */
  dailyMinutes: { used: number; limit: number | null } | null;
}

export interface BillingSettings {
  payAsYouGo: boolean;
  /** Required when pay-as-you-go is on. */
  spendCapCents: number | null;
}

/** A usage alert for core to deliver (e.g. by email). */
export interface BillingNotice {
  userId: string;
  subject: string;
  message: string;
}

export interface Billing {
  readonly enabled: boolean;
  /** Plan ids an admin may assign by hand; empty when billing is off. */
  readonly plans: readonly string[];
  getEntitlements(userId: string): Promise<Entitlements>;
  getEntitlementsForUsers(userIds: string[]): Promise<Map<string, Entitlements>>;
  /** Whether the user may start or resume cloud compute now. */
  checkRunAllowance(userId: string): Promise<RunAllowance>;
  /** Which of these users have used up their allowance, so their running workspaces stop. */
  getUsersOverAllowance(userIds: string[]): Promise<Set<string>>;
  getAccount(userId: string): Promise<BillingAccount | null>;
  updateSettings(userId: string, settings: BillingSettings): Promise<void>;
  /** Current hourly price of each machine profile, in millionths of a dollar. */
  getMachinePrices(machineProfileIds: string[]): Promise<Map<string, number>>;
  /** Admin: price new sessions on this machine profile; null removes the price. */
  setMachinePrice(machineProfileId: string, microsPerHour: number | null): Promise<void>;
  /** Admin override of a user's plan. */
  setPlan(userId: string, plan: string): Promise<void>;
  /** Number of users on each plan, for the admin overview. */
  countUsersByPlan(): Promise<Record<string, number>>;
  /** Clean up billing records before the user is deleted. */
  onUserDeleted(userId: string): Promise<void>;
  /** Report usage to the payment provider and return alerts to deliver. Run by the worker. */
  runPeriodicTasks(): Promise<BillingNotice[]>;
}

export const UNLIMITED_ENTITLEMENTS: Entitlements = {
  plan: null,
  providerKeys: null,
  machineAccess: "any",
  maxWorkspaces: null,
  persistence: true,
  customSubdomain: true,
  alwaysOn: true,
  idleTimeoutMinutes: null,
  retentionDays: null,
};
