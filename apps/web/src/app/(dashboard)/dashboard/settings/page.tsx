import { redirect } from "next/navigation";
import type { Route } from "next";

const SETTINGS_SECTIONS = new Set([
  "account",
  "billing",
  "privacy",
  "workspace",
  "providers",
  "agent-defaults",
  "ssh",
  "teams",
  "api",
  "usage",
]);

export default async function SettingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  redirect(
    `/dashboard/settings/${section && SETTINGS_SECTIONS.has(section) ? section : "account"}` as Route,
  );
}
