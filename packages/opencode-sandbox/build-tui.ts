import solid from "@opentui/solid/bun-plugin";

// OpenCode supplies these at runtime; a second copy would break Solid's reactivity.
const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  external: [
    "@opencode/plugin",
    "@opencode/plugin/*",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
    "solid-js/*",
  ],
  plugins: [solid],
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
