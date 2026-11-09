"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Tone } from "@/components/dashboard/kit";
import { authClient } from "@/lib/auth-client";

/** Sends anyone who isn't an admin away. `ready` is true once the session is an admin's. */
export function useAdminGuard() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) router.push("/login");
    else if (!isAdmin) router.push("/dashboard");
  }, [session?.user, isPending, isAdmin, router]);

  return { ready: !isPending && isAdmin, userId: session?.user.id ?? null };
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 days ago", "yesterday", "just now". */
export function timeAgo(value: Date | string): string {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type ProviderLike = { isEnabled: boolean; providerConfig: { isEnabled: boolean } | null };

/** Whether workspaces can start on a provider, and what to fix if not. */
export function providerStatus(provider: ProviderLike): {
  state: "ready" | "setup" | "off";
  tone: Tone;
  label: string;
} {
  if (!provider.isEnabled) return { state: "off", tone: "muted", label: "Off" };
  if (!provider.providerConfig) return { state: "setup", tone: "warn", label: "No credentials" };
  if (!provider.providerConfig.isEnabled)
    return { state: "setup", tone: "warn", label: "Credentials off" };
  return { state: "ready", tone: "ok", label: "Ready" };
}

/** A form's hairline frame on admin pages. */
export const formPanel = "rounded-xl border border-line p-4 sm:p-5";
