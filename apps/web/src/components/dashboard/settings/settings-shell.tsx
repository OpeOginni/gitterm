"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import {
  BarChart3,
  Braces,
  CloudCog,
  CreditCard,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SettingsItem = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

type SettingsGroup = {
  label: string;
  items: SettingsItem[];
};

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Personal",
    items: [
      {
        id: "account",
        label: "Account",
        description: "Profile and account access",
        icon: UserRound,
      },
      {
        id: "usage",
        label: "Usage",
        description: "Runtime and workspace history",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        id: "providers",
        label: "Providers",
        description: "Cloud and model credentials",
        icon: CloudCog,
      },
      {
        id: "agent-defaults",
        label: "Agent defaults",
        description: "Reusable agent configuration",
        icon: SlidersHorizontal,
      },
      {
        id: "ssh",
        label: "SSH keys",
        description: "Editor access identity",
        icon: KeyRound,
      },
      {
        id: "teams",
        label: "Teams",
        description: "Members and shared access",
        icon: UsersRound,
      },
    ],
  },
  {
    label: "Developer",
    items: [
      {
        id: "api",
        label: "API & tokens",
        description: "CLI, SDK, and access tokens",
        icon: Braces,
      },
    ],
  },
  {
    label: "Plan & data",
    items: [
      {
        id: "billing",
        label: "Billing",
        description: "Plan and subscription",
        icon: CreditCard,
      },
      {
        id: "privacy",
        label: "Privacy",
        description: "Analytics and data choices",
        icon: ShieldCheck,
      },
    ],
  },
];

const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((group) => group.items);

function currentSection(pathname: string): string {
  const section = pathname.split("/").filter(Boolean).at(-1);
  return SETTINGS_ITEMS.some((item) => item.id === section) ? section! : "account";
}

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeSection = currentSection(pathname);
  const activeItem = SETTINGS_ITEMS.find((item) => item.id === activeSection)!;

  return (
    <DashboardShell className="lg:px-12">
      <DashboardHeader
        heading="Settings"
        text="Manage your account, workspace infrastructure, and developer access."
      />

      <div className="lg:hidden">
        <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">
          Settings area
        </label>
        <Select
          value={activeSection}
          onValueChange={(section) => router.push(`/dashboard/settings/${section}` as Route)}
        >
          <SelectTrigger className="h-11 w-full border border-line bg-card px-3">
            <SelectValue>
              <activeItem.icon className="size-4 text-primary" />
              <span>{activeItem.label}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" className="w-[var(--radix-select-trigger-width)]">
            {SETTINGS_GROUPS.map((group, groupIndex) => (
              <SelectGroup key={group.label}>
                {groupIndex > 0 ? <SelectSeparator /> : null}
                <SelectLabel className="font-mono uppercase tracking-[0.16em]">
                  {group.label}
                </SelectLabel>
                {group.items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <item.icon className="size-4" />
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[224px_minmax(0,1fr)] xl:gap-14">
        <aside className="sticky top-20 hidden border-r border-line pr-6 lg:block">
          <nav aria-label="Settings navigation" className="space-y-7">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-4">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = activeSection === item.id;
                    return (
                      <Link
                        key={item.id}
                        href={`/dashboard/settings/${item.id}` as Route}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          isActive ? "bg-fill-2 text-fg" : "text-fg-3 hover:bg-fill hover:text-fg",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute inset-y-2 -left-[25px] w-px bg-primary transition-opacity",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <item.icon
                          className={cn(
                            "size-4 shrink-0 transition-colors",
                            isActive ? "text-primary" : "text-fg-4 group-hover:text-fg-2",
                          )}
                        />
                        <span className="truncate text-[13px] font-medium">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 max-w-4xl">{children}</main>
      </div>
    </DashboardShell>
  );
}
