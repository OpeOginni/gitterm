"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, BookOpen, ChevronsUpDown, LogOut, Menu, Settings } from "lucide-react";
import { Brand as BrandMark } from "@/components/site/site-header";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingAccount } from "@/lib/billing";
import { ADMIN_GROUP, NAV_GROUPS, activeHref, type NavGroup } from "./nav-config";
import { SetupChecklist } from "./setup-checklist";

type UserPlan = "free" | "starter" | "pro";
type SessionUser = { name?: string; email?: string; plan?: UserPlan; role?: string };

function Brand() {
  return (
    <Link
      href={"/dashboard" as Route}
      aria-label="Gitterm dashboard"
      className="rounded-md transition-opacity hover:opacity-85"
    >
      <BrandMark className="text-[17px]" />
    </Link>
  );
}

function NavGroups({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  return (
    <nav aria-label="Dashboard" className="space-y-6">
      {groups.map((group, index) => (
        <div key={group.label ?? index}>
          {group.label ? (
            <p className="mb-1.5 px-2.5 text-[12.5px] font-medium text-fg-4">{group.label}</p>
          ) : null}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = item.href === current;
              return (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 transition-colors",
                    isActive ? "bg-fill-2 text-fg" : "text-fg-3 hover:bg-fill hover:text-fg",
                  )}
                >
                  {/* The gold tick sits on the sidebar's edge and marks the current page. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-2 -left-3 w-0.5 rounded-r-full bg-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      isActive ? "text-primary" : "text-fg-4 group-hover:text-fg-2",
                    )}
                  />
                  <span className="truncate text-[14px] font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** One letter, the same as the avatar on the Account page. */
const initial = (user: SessionUser) => (user.name || user.email || "?").charAt(0).toUpperCase();

function UserMenu({ user, onNavigate }: { user: SessionUser; onNavigate?: () => void }) {
  const router = useRouter();
  const account = useBillingAccount().data?.account;
  // Paid plans show in place of the email (which stays in the menu below).
  const paidPlan = account && account.plan !== "free" ? account.planName : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors outline-none hover:bg-fill focus-visible:bg-fill">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[13px] font-semibold text-[#e2c47c]">
          {initial(user)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{user.name}</span>
          {paidPlan ? (
            <span className="block truncate text-[12.5px] text-[#e2c47c]">{paidPlan} plan</span>
          ) : (
            <span className="block truncate text-[12.5px] text-fg-4">{user.email}</span>
          )}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-fg-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56 border-line bg-popover">
        <DropdownMenuLabel className="truncate text-[12.5px] font-normal text-fg-3">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-line" />
        <DropdownMenuItem
          asChild
          className="cursor-pointer gap-2 text-fg-2 focus:bg-fill focus:text-fg"
        >
          <Link href={"/dashboard/settings/account" as Route} onClick={onNavigate}>
            <Settings className="size-4" />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          asChild
          className="cursor-pointer gap-2 text-fg-2 focus:bg-fill focus:text-fg"
        >
          {/* A new tab keeps the dashboard open; self-hosted deployments redirect /docs to gitterm.dev. */}
          <a href="/docs" target="_blank" rel="noreferrer" onClick={onNavigate}>
            <BookOpen className="size-4" />
            Docs
            <ArrowUpRight className="ml-auto size-3.5 text-fg-4" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => authClient.signOut().then(() => router.push("/"))}
          className="cursor-pointer gap-2 text-red-300 focus:bg-red-500/10 focus:text-red-300 [&_svg]:!text-red-300"
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user as SessionUser | undefined;
  const groups = user?.role === "admin" ? [...NAV_GROUPS, ADMIN_GROUP] : NAV_GROUPS;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <NavGroups groups={groups} onNavigate={onNavigate} />
      </div>
      <div className="shrink-0 space-y-2 border-t border-line p-3">
        <SetupChecklist onNavigate={onNavigate} />
        {isPending || !user ? (
          <Skeleton className="h-10 w-full bg-fill" />
        ) : (
          <UserMenu user={user} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}

/** The dashboard's one navigation: a fixed rail on desktop, a sheet behind a menu on mobile. */
export function AppSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-line bg-sidebar md:block">
        <SidebarBody />
      </aside>

      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-background/85 px-4 backdrop-blur-xl md:hidden">
        <Brand />
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
          className="-mr-1 flex size-11 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-fill-2 hover:text-fg"
        >
          <Menu className="size-5" />
        </button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-0 border-line bg-sidebar p-0 sm:max-w-72">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Dashboard pages and settings</SheetDescription>
          <SidebarBody onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
