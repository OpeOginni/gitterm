import path from "node:path";
import type { NextConfig } from "next";

// Set by apps/web/Dockerfile. Emits a self-contained server (.next/standalone) so
// the image ships only traced runtime dependencies instead of the whole monorepo
// node_modules. Kept opt-in because moving the tracing root also moves Turbopack's
// root, which breaks Tailwind's `@import "tailwindcss"` resolution in `next dev`
// (vercel/next.js#98023).
const standalone = process.env.NEXT_STANDALONE === "1";

const nextConfig: NextConfig = {
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: path.join(__dirname, "../../") }
    : {}),
  typedRoutes: true,
  reactCompiler: true,
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

export default nextConfig;
