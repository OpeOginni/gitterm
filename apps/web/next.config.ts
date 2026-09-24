import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) so the Docker image only
  // ships traced runtime dependencies instead of the whole monorepo node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
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
