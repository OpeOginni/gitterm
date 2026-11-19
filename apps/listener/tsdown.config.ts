import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  // Bundle every dependency: the image ships only dist/, with no node_modules.
  noExternal: [/.*/],
});
