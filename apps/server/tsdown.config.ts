import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "src/index": "./src/index.ts",
    "scripts/seed-admin": "./scripts/seed-admin.ts",
    // Bundled so the production image can bootstrap the database without node_modules.
    "scripts/migrate": "../../packages/db/src/migrate-cli.ts",
    "scripts/seed": "../../packages/db/src/seed-cli.ts",
  },
  format: "esm",
  outDir: "./dist",
  clean: true,
  // Bundle all dependencies
  noExternal: [/.*/],
});
