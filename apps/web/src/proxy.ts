import { NextResponse, type NextRequest } from "next/server";
import { isSelfHosted } from "@gitterm/env/web";

/**
 * Self-hosted deployments serve only the app. This runs per request on purpose: the Docker image
 * is built once and its deployment mode is filled in when the container starts, so nothing about
 * it can be decided at build time. Managed deployments pass straight through.
 */

const DOCS = "https://gitterm.dev";
const MARKETING = ["/pricing", "/privacy", "/terms", "/self-host", "/checkout", "/sitemap.xml"];

export function proxy(request: NextRequest) {
  if (!isSelfHosted()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;

  // The dashboard sends signed-out visitors on to /login
  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));

  // The docs live in one place, on gitterm.dev
  if (pathname === "/docs" || pathname.startsWith("/docs/") || pathname.startsWith("/llms")) {
    return NextResponse.redirect(`${DOCS}${pathname}${search}`);
  }

  // A private deployment should not be indexed
  if (pathname === "/robots.txt") {
    return new NextResponse("User-Agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (MARKETING.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // No such route, so Next answers with its 404 page
    return NextResponse.rewrite(new URL("/_not-on-self-hosted", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/docs/:path*",
    "/llms.txt",
    "/llms-full.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/pricing",
    "/privacy",
    "/terms",
    "/self-host",
    "/checkout/:path*",
  ],
};
