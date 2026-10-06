"use client";

import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { authClient } from "@/lib/auth-client";

/** The viewer's billing account (null when billing is off) and what they may use. */
export function useBillingAccount() {
  const { data: session } = authClient.useSession();
  return useQuery({ ...trpc.billing.account.queryOptions(), enabled: !!session?.user });
}

/** The viewer's plan id; "free" while loading, signed out, or without billing. */
export function useCurrentPlan(): string {
  return useBillingAccount().data?.account?.plan ?? "free";
}
