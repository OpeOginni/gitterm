import { redirect } from "next/navigation";
import type { Route } from "next";

export default function WorkspaceSettingsPage() {
  redirect("/dashboard/models" as Route);
}
