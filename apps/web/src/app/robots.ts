import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/docs/content";

/** Everyone, agents included, may read the site and docs. The signed-in app and the API are off limits. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api/", "/device"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
