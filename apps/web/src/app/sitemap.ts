import type { MetadataRoute } from "next";
import { isBillingEnabled } from "@gitterm/env/web";
import { SITE_URL, getNavPages } from "@/lib/docs/content";

/** The public pages and every docs page. Pricing only where billing is on. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    "",
    "/self-host",
    "/privacy",
    "/terms",
    ...(isBillingEnabled() ? ["/pricing"] : []),
  ];
  return [
    ...pages.map((p) => ({ url: `${SITE_URL}${p}` })),
    ...getNavPages().map((d) => ({ url: `${SITE_URL}/docs/${d.slug}` })),
  ];
}
