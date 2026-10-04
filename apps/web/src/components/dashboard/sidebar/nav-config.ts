import {
  BarChart3,
  Bot,
  Cloud,
  CreditCard,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  Link2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string | null; items: NavItem[] };

/**
 * Everything in the dashboard, in the order people need it: what they run, what their agents
 * connect to, then their own settings. Admin tools are appended for admins.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Workspaces", icon: LayoutDashboard },
      { href: "/dashboard/bots", label: "Bots", icon: Bot },
    ],
  },
  {
    label: "Connect",
    items: [
      { href: "/dashboard/models", label: "Models", icon: Sparkles },
      { href: "/dashboard/integrations", label: "Integrations", icon: Link2 },
      { href: "/dashboard/compute", label: "Compute", icon: Cloud },
      { href: "/dashboard/settings/api", label: "API tokens", icon: KeySquare },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/dashboard/settings/account", label: "Account", icon: UserRound },
      { href: "/dashboard/settings/usage", label: "Usage", icon: BarChart3 },
      { href: "/dashboard/settings/billing", label: "Billing", icon: CreditCard },
      {
        href: "/dashboard/settings/agent-defaults",
        label: "Agent defaults",
        icon: SlidersHorizontal,
      },
      { href: "/dashboard/settings/ssh", label: "SSH keys", icon: KeyRound },
      { href: "/dashboard/settings/privacy", label: "Privacy", icon: ShieldCheck },
    ],
  },
];

export const ADMIN_GROUP: NavGroup = {
  label: "Admin",
  items: [{ href: "/admin", label: "Admin panel", icon: Shield }],
};

/** The item for the current page: the longest href the path starts with. */
export function activeHref(pathname: string, groups: NavGroup[]): string | undefined {
  return groups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .toSorted((a, b) => b.length - a.length)[0];
}
