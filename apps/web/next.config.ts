import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  typescript: {
    // We run type checking separately
    ignoreBuildErrors: false,
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
