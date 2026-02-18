"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { Users, Server, Image, Globe, ChevronRight, Settings } from "lucide-react";
import Link from "next/link";
import { trpcClient } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import type { Route } from "next";

const NAV_ITEMS = [
  {
    href: "/admin/users" as Route,
    icon: Users,
    title: "User Management",
    description: "View, manage, and update user accounts and roles.",
  },
  {
    href: "/admin/providers" as Route,
    icon: Globe,
    title: "Cloud Providers",
    description: "Configure cloud providers and regions for workspaces.",
  },
  {
    href: "/admin/agents" as Route,
    icon: Server,
    title: "Agent Types",
    description: "Configure the types of agents users can deploy.",
  },
  {
    href: "/admin/images" as Route,
    icon: Image,
    title: "Container Images",
    description: "Manage Docker images used for workspaces.",
  },
  {
    href: "/admin/settings" as Route,
    icon: Settings,
    title: "System Settings",
    description: "Configure idle timeout, quotas, and other system settings.",
  },
];

function StatCell({
  label,
  value,
  sub,
  isLoading,
}: {
  label: string;
  value: number;
  sub: string;
  isLoading: boolean;
}) {
  return (
    <div className="text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
        {label}
      </p>
      {isLoading ? (
        <Skeleton className="mx-auto mt-1.5 h-8 w-14 bg-white/[0.04]" />
      ) : (
        <p className="mt-1 text-2xl font-bold tabular-nums text-white">
          {value}
        </p>
      )}
      <p className="text-xs text-white/30">{sub}</p>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();

  useEffect(() => {
    if (!isSessionPending) {
      if (!session?.user) {
        router.push("/login");
        return;
      }
      if ((session.user as any)?.role !== "admin") {
        router.push("/dashboard");
      }
    }
  }, [session, isSessionPending, router]);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => trpcClient.admin.users.stats.query(),
  });

  if (
    isSessionPending ||
    !session?.user ||
    (session.user as any)?.role !== "admin"
  ) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Skeleton className="h-8 w-48 bg-white/[0.04]" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Admin Panel"
        text="Manage infrastructure, users, and system settings."
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:grid-cols-4">
        <StatCell
          label="Total Users"
          value={stats?.users.total ?? 0}
          sub={`${stats?.users.admins ?? 0} admins`}
          isLoading={isLoading}
        />
        <StatCell
          label="Active"
          value={stats?.workspaces.running ?? 0}
          sub={`${stats?.workspaces.total ?? 0} total`}
          isLoading={isLoading}
        />
        <StatCell
          label="Paid"
          value={stats?.users.paid ?? 0}
          sub={`${stats?.users.free ?? 0} free`}
          isLoading={isLoading}
        />
        <StatCell
          label="Stopped"
          value={stats?.workspaces.stopped ?? 0}
          sub="can resume"
          isLoading={isLoading}
        />
      </div>

      {/* Nav list */}
      <div className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center justify-between rounded-2xl p-4 transition-colors hover:bg-white/[0.03]"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-white/[0.04] p-2.5 transition-colors group-hover:bg-white/[0.06]">
                <item.icon className="h-5 w-5 text-white/40" />
              </div>
              <div>
                <p className="font-medium text-white/80">{item.title}</p>
                <p className="text-sm text-white/35">{item.description}</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-white/20 transition-transform group-hover:translate-x-0.5 group-hover:text-white/40" />
          </Link>
        ))}
      </div>
    </DashboardShell>
  );
}
