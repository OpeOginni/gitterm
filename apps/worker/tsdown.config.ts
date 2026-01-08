import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/idle-reaper.ts", "./src/daily-reset.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@gitterm\/.*/],
});
