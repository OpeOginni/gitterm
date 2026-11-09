"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { DeleteAccountSection } from "@/components/dashboard/delete-account";
import { BillingSection } from "@/components/dashboard/billing-section";
import { UsageSection } from "@/components/dashboard/settings/usage-section";
import { Panel, PanelRow } from "@/components/dashboard/kit";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, isBillingEnabled } from "@/lib/auth-client";
import { useBillingAccount } from "@/lib/billing";
import { SettingsPart } from "./settings-page";

function memberSince(createdAt: Date | string | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Who is signed in, at a glance, with the plan one click from its settings. */
function ProfileRow() {
  const { data: session } = authClient.useSession();
  const billing = useBillingAccount();
  const planName = billing.data?.account?.planName ?? "Free";
  const user = session?.user;

  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const joined = memberSince(user?.createdAt);

  return (
    <Panel>
      <PanelRow className="gap-4 py-4">
        {user?.image ? (
          <Image
            src={user.image}
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-lg font-semibold text-primary">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[19px] font-semibold tracking-[-0.02em] text-fg">
            {user?.name ?? "Your account"}
          </p>
          <p className="text-[13.5px] text-fg-3">
            <span className="block truncate sm:inline">{user?.email ?? ""}</span>
            {joined ? (
              <span className="block text-fg-4 sm:inline">
                <span className="max-sm:hidden"> · </span>Member since {joined}
              </span>
            ) : null}
          </p>
        </div>
        {isBillingEnabled && (
          <Link
            href={"/dashboard/settings/account#billing" as Route}
            aria-label="Manage current plan"
            className="shrink-0 rounded-lg px-3 py-2 text-right transition-colors hover:bg-fill"
          >
            <p className="text-[12.5px] text-fg-3">Plan</p>
            {billing.isPending ? (
              <Skeleton className="mt-1 ml-auto h-4 w-10 bg-fill-2" />
            ) : (
              <p className="text-[14px] font-medium text-primary">{planName}</p>
            )}
          </Link>
        )}
      </PanelRow>
    </Panel>
  );
}

export function AccountSection() {
  return (
    <div className="space-y-12">
      <ProfileRow />
      <SettingsPart id="usage" label="Usage">
        <UsageSection />
      </SettingsPart>
      <SettingsPart id="billing" label="Plan and billing">
        <BillingSection />
      </SettingsPart>
      <DeleteAccountSection />
    </div>
  );
}
