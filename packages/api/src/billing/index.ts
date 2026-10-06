/**
 * Billing entry point for the open core.
 *
 * Managed deployments load `@gitterm/billing` (plans, quotas, Polar); every
 * other deployment gets `unlimitedBilling`, which allows everything and never
 * loads billing code.
 */
import { UNLIMITED_ENTITLEMENTS, type Billing, type Entitlements } from "@gitterm/schema/billing";
import { isManaged } from "../config/deployment";

export const unlimitedBilling: Billing = {
  enabled: false,
  plans: [],
  getEntitlements: async () => UNLIMITED_ENTITLEMENTS,
  getEntitlementsForUsers: async (userIds) =>
    new Map(userIds.map((userId) => [userId, UNLIMITED_ENTITLEMENTS])),
  checkRunAllowance: async () => ({ allowed: true }),
  getUsersOverAllowance: async () => new Set(),
  getAccount: async () => null,
  setPlan: async () => {
    throw new Error("Billing is not enabled on this deployment");
  },
  countUsersByPlan: async () => ({}),
  onUserDeleted: async () => {},
};

let billing: Promise<Billing> | undefined;

export function getBilling(): Promise<Billing> {
  billing ??= isManaged()
    ? import("@gitterm/billing").then(({ createBilling }) => createBilling())
    : Promise.resolve(unlimitedBilling);
  return billing;
}

export function canUseProvider(entitlements: Entitlements, providerKey: string): boolean {
  return (
    entitlements.providerKeys === null ||
    entitlements.providerKeys.includes(providerKey.toLowerCase())
  );
}
