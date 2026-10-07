import path from "node:path";
import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";

// Set by apps/web/Dockerfile. Emits a self-contained server (.next/standalone) so
// the image ships only traced runtime dependencies instead of the whole monorepo
// node_modules. Kept opt-in because moving the tracing root also moves Turbopack's
// root, which breaks Tailwind's `@import "tailwindcss"` resolution in `next dev`
// (vercel/next.js#98023).
const standalone = process.env.NEXT_STANDALONE === "1";
const analyticsConfigured =
  !!process.env.NEXT_PUBLIC_POSTHOG_KEY && !!process.env.NEXT_PUBLIC_POSTHOG_HOST;
const analyticsNoop = "@gitterm/analytics/noop";

const nextConfig: NextConfig = {
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: path.join(__dirname, "../../") }
    : {}),
  typedRoutes: true,
  reactCompiler: true,
  // Self-hosted builds without analytics configuration omit the SDK entirely,
  // rather than merely hiding it behind a lazy chunk. Configured builds still
  // download that chunk only after consent. Public env changes require a rebuild.
  turbopack: {
    resolveAlias: analyticsConfigured ? {} : { "@gitterm/analytics/adapter": analyticsNoop },
  },
  webpack(config) {
    if (!analyticsConfigured) {
      config.resolve.alias["@gitterm/analytics/adapter$"] = analyticsNoop;
    }
    return config;
  },
  typescript: {
    // We run type checking separately
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "github.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
  async rewrites() {
    return [
      { source: "/favicon.ico", destination: "/favicon_io/favicon.ico" },
      {
        source: "/favicon-16x16.png",
        destination: "/favicon_io/favicon-16x16.png",
      },
      {
        source: "/favicon-32x32.png",
        destination: "/favicon_io/favicon-32x32.png",
      },
      {
        source: "/apple-touch-icon.png",
        destination: "/favicon_io/apple-touch-icon.png",
      },
      {
        source: "/android-chrome-192x192.png",
        destination: "/favicon_io/android-chrome-192x192.png",
      },
      {
        source: "/android-chrome-512x512.png",
        destination: "/favicon_io/android-chrome-512x512.png",
      },
      {
        source: "/site.webmanifest",
        destination: "/favicon_io/site.webmanifest",
      },
    ];
  },
};

// Upload only the exact build being deployed, with CI secrets (never NEXT_PUBLIC).
// Unconfigured/self-hosted builds do not generate or upload browser source maps.
const uploadSourceMaps =
  analyticsConfigured && !!process.env.POSTHOG_API_KEY && !!process.env.POSTHOG_PROJECT_ID;

export default uploadSourceMaps
  ? withPostHogConfig(nextConfig, {
      personalApiKey: process.env.POSTHOG_API_KEY!,
      projectId: process.env.POSTHOG_PROJECT_ID!,
      host: process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com",
      sourcemaps: {
        enabled: true,
        releaseName: "gitterm-web",
        releaseVersion: process.env.POSTHOG_RELEASE_VERSION ?? process.env.RAILWAY_GIT_COMMIT_SHA,
        deleteAfterUpload: true,
      },
    })
  : nextConfig;
