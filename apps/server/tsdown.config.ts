import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./scripts/seed-admin.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  // Bundle all dependencies
  noExternal: [/.*/],
});
