import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  // Transpile workspace packages
  transpilePackages: ["@gitterm/env", "@gitterm/schema"],
  // Ignore build errors from type-only imports
  typescript: {
    // We run type checking separately
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
