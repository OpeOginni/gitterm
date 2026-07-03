"use client";

import Image from "next/image";
import { BillingSection } from "@/components/dashboard/billing-section";
import { DeleteAccountSection } from "@/components/dashboard/delete-account";
import { FormCard, FormCardBody, FormCardHeader } from "@/components/ui/form-card";
import { authClient } from "@/lib/auth-client";

interface AccountSectionProps {
  currentPlan: "free" | "starter" | "pro";
}

function memberSince(createdAt: Date | string | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * Identity card - who is signed in, at a glance. Plan status and billing
 * live in the BillingSection below; API tokens have their own settings tab.
 */
function ProfileCard() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const joined = memberSince(user?.createdAt);

  return (
    <FormCard>
      <FormCardHeader>
        <span>Account</span>
        {joined && <span className="text-white/30">Member since {joined}</span>}
      </FormCardHeader>
      <FormCardBody>
        <div className="flex flex-wrap items-center gap-4">
          {user?.image ? (
            <Image
              src={user.image}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-xl border border-white/[0.08] object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-primary/10 font-mono text-lg text-primary">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold tracking-tight text-white">
              {user?.name ?? "—"}
            </h3>
            <p className="truncate text-sm text-white/45">{user?.email ?? ""}</p>
          </div>
        </div>
      </FormCardBody>
    </FormCard>
  );
}

export function AccountSection({ currentPlan }: AccountSectionProps) {
  return (
    <div className="space-y-6">
      <ProfileCard />
      <BillingSection currentPlan={currentPlan} />
      <DeleteAccountSection />
    </div>
  );
}
