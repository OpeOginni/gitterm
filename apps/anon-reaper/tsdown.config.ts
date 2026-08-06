import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/anon-reaper.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@gitterm\/.*/],
});
