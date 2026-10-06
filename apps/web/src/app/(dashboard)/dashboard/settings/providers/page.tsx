import { redirect } from "next/navigation";
import type { Route } from "next";

// Providers split into Models and Compute in the dashboard sidebar.
export default function ProviderSettingsPage() {
  redirect("/dashboard/models" as Route);
}
