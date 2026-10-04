import { redirect } from "next/navigation";
import type { Route } from "next";

// Usage is part of the Account page.
export default function UsageSettingsPage() {
  redirect("/dashboard/settings/account#usage" as Route);
}
