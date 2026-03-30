"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { DashboardShell, DashboardHeader } from "@/components/dashboard/shell";
import {
  BarChart3,
  CreditCard,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { UsageSection } from "./usage-section";
import { WorkspaceSection } from "./workspace-section";
import { AccountSection } from "./account-section";

type SettingsSection = "usage" | "workspace" | "account";

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  description: string;
}

const sidebarItems: SidebarItem[] = [
  {
    id: "usage",
    label: "Usage",
    icon: BarChart3,
    description: "Quota and workspace history",
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: Wrench,
    description: "SSH, credentials, and config",
  },
  {
    id: "account",
    label: "Account",
    icon: CreditCard,
    description: "Plan and account management",
  },
];

interface SettingsShellProps {
  currentPlan: "free" | "pro";
}

export function SettingsShell({ currentPlan }: SettingsShellProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("usage");

  const handleSectionChange = useCallback((section: SettingsSection) => {
    setActiveSection(section);
  }, []);

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Settings"
        text="Manage your usage, workspace configuration, and account."
      />

      <div className="mx-auto max-w-6xl">
        {/* Mobile tab bar */}
        <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-3 lg:hidden">
          {sidebarItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSectionChange(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-white/[0.08] text-white"
                    : "text-white/40 hover:bg-white/[0.04] hover:text-white/60",
                )}
              >
                <item.icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-white/30")} />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Desktop: sidebar + content */}
        <div className="flex gap-8 pt-6 lg:pt-2">
          {/* Sidebar -- desktop only */}
          <nav className="hidden w-60 shrink-0 lg:block">
            <div className="sticky top-20 space-y-1">
              {sidebarItems.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSectionChange(item.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      isActive
                        ? "bg-white/[0.06] text-white"
                        : "text-white/40 hover:bg-white/[0.03] hover:text-white/60",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        isActive ? "text-primary" : "text-white/30 group-hover:text-white/50",
                      )}
                    />
                    <div className="min-w-0">
                      <span className="font-medium">{item.label}</span>
                      <p
                        className={cn(
                          "text-xs truncate",
                          isActive ? "text-white/40" : "text-white/20",
                        )}
                      >
                        {item.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="space-y-6">
              {activeSection === "usage" && <UsageSection />}
              {activeSection === "workspace" && <WorkspaceSection />}
              {activeSection === "account" && <AccountSection currentPlan={currentPlan} />}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
