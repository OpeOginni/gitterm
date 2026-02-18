"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Terminal,
  LayoutDashboard,
  Link2,
  BarChart3,
  User,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Settings,
  Shield,
  Repeat,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { Skeleton } from "../ui/skeleton";
import { PlanBadge } from "./billing-section";
import type { Route } from "next";

type UserPlan = "free" | "pro";

const navItems = [
  { href: "/dashboard", label: "Workspaces", icon: LayoutDashboard },
  { href: "/dashboard/loops", label: "Agent Loops", icon: Repeat },
  { href: "/dashboard/integrations", label: "Integrations", icon: Link2 },
  { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
];

export function DashboardNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-70"
          >
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider text-white/90">
              GitTerm
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href as any}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-white/40 hover:bg-white/[0.04] hover:text-white/70",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isPending ? (
              <Skeleton className="h-8 w-20 bg-white/[0.04]" />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="hidden h-8 items-center gap-2 border-white/[0.08] bg-transparent px-2.5 text-xs text-white/60 hover:border-white/[0.15] hover:bg-white/[0.04] hover:text-white/80 md:flex"
                  >
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-3 w-3 text-primary" />
                    </div>
                    <span className="max-w-[100px] truncate font-mono text-xs">
                      {session?.user?.name}
                    </span>
                    <PlanBadge
                      plan={
                        ((session?.user as any)?.plan as UserPlan) || "free"
                      }
                    />
                    <ChevronDown className="h-3 w-3 text-white/30" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-48 border-white/[0.08] bg-[#0e0e11]">
                  {(session?.user as any)?.role === "admin" && (
                    <>
                      <DropdownMenuItem
                        asChild
                        className="cursor-pointer gap-2 text-white/60 focus:bg-white/[0.04] focus:text-white/80"
                      >
                        <Link href={"/admin" as Route}>
                          <Shield className="h-4 w-4" />
                          Admin Panel
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-white/[0.06]" />
                    </>
                  )}
                  <DropdownMenuItem
                    asChild
                    className="cursor-pointer gap-2 text-white/60 focus:bg-white/[0.04] focus:text-white/80"
                  >
                    <Link href={"/dashboard/settings" as Route}>
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/[0.06]" />
                  <DropdownMenuItem
                    onClick={() =>
                      authClient.signOut().then(() => {
                        router.push("/");
                      })
                    }
                    className="cursor-pointer gap-2 text-red-400/70 focus:bg-red-500/10 focus:text-red-400"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="text-white/50 hover:bg-white/[0.04] hover:text-white/80 md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="border-t border-white/[0.06] bg-[#09090b] md:hidden">
          <nav className="space-y-1 px-4 py-3">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href as any}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-white/40 hover:bg-white/[0.04] hover:text-white/70",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              {(session?.user as any)?.role === "admin" && (
                <Link
                  href={"/admin" as Route}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/70"
                >
                  <Shield className="h-4 w-4" />
                  Admin Panel
                </Link>
              )}
              <Link
                href={"/dashboard/settings" as Route}
                onClick={() => setMobileMenuOpen(false)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/70"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              <button
                onClick={() =>
                  authClient.signOut().then(() => router.push("/"))
                }
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-400/70 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
