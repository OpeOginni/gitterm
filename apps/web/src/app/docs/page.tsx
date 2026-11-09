import type { Route } from "next";
import { redirect } from "next/navigation";

export default function DocsIndex() {
  redirect("/docs/introduction" as Route);
}
