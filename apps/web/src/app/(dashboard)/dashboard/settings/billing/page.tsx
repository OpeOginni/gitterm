import { redirect } from "next/navigation";
import type { Route } from "next";

// Billing is part of the Account page.
export default function BillingSettingsPage() {
  redirect("/dashboard/settings/account#billing" as Route);
}
