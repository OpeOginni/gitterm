"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { DeleteAccountSection } from "@/components/dashboard/delete-account";
import { FormCard, FormCardBody, FormCardHeader } from "@/components/ui/form-card";
import { authClient } from "@/lib/auth-client";

type UserPlan = "free" | "starter" | "pro";

function memberSince(createdAt: Date | string | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/**
 * Identity card - who is signed in, at a glance. Billing and API tokens live
 * on their own focused settings pages.
 */
function ProfileCard({ currentPlan }: { currentPlan: UserPlan }) {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();
  const joined = memberSince(user?.createdAt);

  return (
    <FormCard>
      <FormCardHeader>
        <span>Account</span>
        {joined && <span className="text-fg-4">Member since {joined}</span>}
      </FormCardHeader>
      <FormCardBody>
        <div className="flex flex-wrap items-center gap-4">
          {user?.image ? (
            <Image
              src={user.image}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-xl border border-line object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line bg-primary/10 font-mono text-lg text-primary">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold tracking-tight text-white">
              {user?.name ?? "—"}
            </h3>
            <p className="truncate text-sm text-fg-3">{user?.email ?? ""}</p>
          </div>
          <Link
            href={"/dashboard/settings/billing" as Route}
            aria-label="Manage current plan"
            className="group flex items-center gap-3 border-l border-line pl-4"
          >
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-4">
                Current plan
              </p>
              <p className="mt-0.5 text-sm font-medium capitalize text-primary">{currentPlan}</p>
            </div>
          </Link>
        </div>
      </FormCardBody>
    </FormCard>
  );
}

export function AccountSection({ currentPlan }: { currentPlan: UserPlan }) {
  return (
    <div className="space-y-6">
      <ProfileCard currentPlan={currentPlan} />
      <DeleteAccountSection />
    </div>
  );
}
