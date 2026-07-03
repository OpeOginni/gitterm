"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { DashboardShell, DashboardHeader } from "@/components/dashboard/shell";
import { BarChart3, CreditCard, Shield, UsersRound, Wrench, type LucideIcon } from "lucide-react";

import { UsageSection } from "./usage-section";
import { WorkspaceSection } from "./workspace-section";
import { AccountSection } from "./account-section";
import { PrivacySection } from "./privacy-section";
import { TeamsSection } from "./teams-section";

type SettingsSection = "usage" | "workspace" | "teams" | "account" | "privacy";

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
    id: "teams",
    label: "Teams",
    icon: UsersRound,
    description: "Collaborators and shared access",
  },
  {
    id: "account",
    label: "Account",
    icon: CreditCard,
    description: "Plan and account management",
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: Shield,
    description: "Analytics and data preferences",
  },
];

const SECTION_IDS: SettingsSection[] = ["usage", "workspace", "teams", "account", "privacy"];

function isSettingsSection(value: string | undefined): value is SettingsSection {
  return !!value && SECTION_IDS.includes(value as SettingsSection);
}

interface SettingsShellProps {
  currentPlan: "free" | "starter" | "pro";
  initialSection?: string;
}

export function SettingsShell({ currentPlan, initialSection }: SettingsShellProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    isSettingsSection(initialSection) ? initialSection : "usage",
  );

  const handleSectionChange = useCallback((section: SettingsSection) => {
    setActiveSection(section);
  }, []);

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Settings"
        text="Manage your usage, workspace configuration, and account."
      />

      <div>
        {/* Mobile tab bar */}
        <div className="grid grid-cols-5 gap-1 border-b border-white/[0.06] pb-3 lg:hidden">
          {sidebarItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSectionChange(item.id)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 rounded-lg px-1 py-2.5 text-xs font-medium transition-colors",
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
          <nav className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-20 overflow-hidden rounded-2xl border border-white/[0.06] bg-card">
              <div className="border-b border-white/[0.04] bg-white/[0.015] px-4 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">
                  Settings
                </span>
              </div>
              <div className="space-y-0.5 p-2">
                {sidebarItems.map((item, index) => {
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSectionChange(item.id)}
                      className={cn(
                        "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all",
                        isActive
                          ? "bg-primary/[0.07] text-white"
                          : "text-white/40 hover:bg-white/[0.03] hover:text-white/65",
                      )}
                    >
                      {/* active accent bar */}
                      <span
                        className={cn(
                          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all",
                          isActive ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                          isActive
                            ? "bg-primary/15"
                            : "bg-white/[0.04] group-hover:bg-white/[0.06]",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            isActive ? "text-primary" : "text-white/35 group-hover:text-white/55",
                          )}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block font-medium">{item.label}</span>
                        <p
                          className={cn(
                            "truncate text-xs",
                            isActive ? "text-white/40" : "text-white/20",
                          )}
                        >
                          {item.description}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "font-mono text-[10px] tabular-nums transition-colors",
                          isActive ? "text-primary/60" : "text-white/15",
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="space-y-6">
              {activeSection === "usage" && <UsageSection />}
              {activeSection === "workspace" && <WorkspaceSection />}
              {activeSection === "teams" && <TeamsSection />}
              {activeSection === "account" && <AccountSection currentPlan={currentPlan} />}
              {activeSection === "privacy" && <PrivacySection />}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
