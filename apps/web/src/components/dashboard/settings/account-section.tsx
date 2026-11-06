"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { DeleteAccountSection } from "@/components/dashboard/delete-account";
import { BillingSection } from "@/components/dashboard/billing-section";
import { UsageSection } from "@/components/dashboard/settings/usage-section";
import { authClient, isBillingEnabled } from "@/lib/auth-client";
import { useBillingAccount } from "@/lib/billing";
import { SettingsGroup, SettingsPart } from "./settings-page";

function memberSince(createdAt: Date | string | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Identity card: who is signed in, at a glance. */
function ProfileCard() {
  const { data: session } = authClient.useSession();
  const planName = useBillingAccount().data?.account?.planName ?? "Free";
  const user = session?.user;

  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const joined = memberSince(user?.createdAt);

  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center gap-4">
        {user?.image ? (
          <Image
            src={user.image}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-medium text-primary">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-medium tracking-[-0.01em] text-fg">
            {user?.name ?? "—"}
          </p>
          <p className="truncate text-[14px] text-fg-3">
            {user?.email ?? ""}
            {joined ? <span className="text-fg-4"> · Member since {joined}</span> : null}
          </p>
        </div>
        {isBillingEnabled && (
          <Link
            href={"/dashboard/settings/account#billing" as Route}
            aria-label="Manage current plan"
            className="group rounded-xl bg-fill px-4 py-2.5 transition-colors hover:bg-fill-2"
          >
            <p className="text-[12.5px] text-fg-3">Current plan</p>
            <p className="text-[14px] font-medium text-[#e2c47c]">{planName}</p>
          </Link>
        )}
      </div>
    </SettingsGroup>
  );
}

export function AccountSection() {
  return (
    <div className="space-y-8">
      <ProfileCard />
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
