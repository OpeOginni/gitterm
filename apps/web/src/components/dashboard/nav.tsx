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
  User,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Settings,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { ShareIcon } from "@/components/icons/share";
import { Skeleton } from "../ui/skeleton";
import { PlanBadge } from "./billing-section";
import type { Route } from "next";

type UserPlan = "free" | "starter" | "pro";

const navItems = [
  { href: "/dashboard", label: "Workspaces", icon: LayoutDashboard },
  // { href: "/dashboard/loops", label: "Agent Loops", icon: Repeat },
  { href: "/dashboard/shared", label: "Shared", icon: ShareIcon },
  { href: "/dashboard/integrations", label: "Integrations", icon: Link2 },
];

export function DashboardNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-line bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider text-fg">
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
                      : "text-fg-4 hover:bg-fill hover:text-fg-2",
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
              <Skeleton className="h-8 w-20 bg-fill" />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="hidden h-8 items-center gap-2 border-line bg-transparent px-2.5 text-xs text-fg-2 hover:border-line-2 hover:bg-fill hover:text-fg md:flex"
                  >
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-3 w-3 text-primary" />
                    </div>
                    <span className="max-w-[100px] truncate font-mono text-xs">
                      {session?.user?.name}
                    </span>
                    <PlanBadge plan={((session?.user as any)?.plan as UserPlan) || "free"} />
                    <ChevronDown className="h-3 w-3 text-fg-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 border-line bg-popover">
                  <DropdownMenuItem
                    asChild
                    className="cursor-pointer gap-2 text-fg-2 focus:bg-fill focus:text-fg"
                  >
                    <Link href={"/dashboard/settings/account" as Route}>
                      <Settings className="h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  {(session?.user as any)?.role === "admin" && (
                    <DropdownMenuItem
                      asChild
                      className="cursor-pointer gap-2 text-fg-2 focus:bg-fill focus:text-fg"
                    >
                      <Link href={"/admin" as Route}>
                        <Shield className="h-4 w-4" />
                        Admin Panel
                      </Link>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator className="bg-fill-2" />
                  <DropdownMenuItem
                    onClick={() =>
                      authClient.signOut().then(() => {
                        router.push("/");
                      })
                    }
                    className="cursor-pointer gap-2 text-red-400/70 focus:bg-red-500/10 focus:text-red-400"
                  >
                    <LogOut className="h-4 w-4 text-red-400 opacity-70" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="text-fg-3 hover:bg-fill hover:text-fg md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="border-t border-line bg-background md:hidden">
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
                      : "text-fg-4 hover:bg-fill hover:text-fg-2",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-line pt-2">
              <Link
                href={"/dashboard/settings/account" as Route}
                onClick={() => setMobileMenuOpen(false)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-fg-4 transition-colors hover:bg-fill hover:text-fg-2"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              {(session?.user as any)?.role === "admin" && (
                <Link
                  href={"/admin" as Route}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-fg-4 transition-colors hover:bg-fill hover:text-fg-2"
                >
                  <Shield className="h-4 w-4" />
                  Admin Panel
                </Link>
              )}
              <button
                onClick={() => authClient.signOut().then(() => router.push("/"))}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-400/70 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4 text-red-400 opacity-70" />
                Sign Out
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
