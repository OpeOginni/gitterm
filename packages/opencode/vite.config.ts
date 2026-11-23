import { gui } from "@opencode/plugin/gui/vite";
import { defineConfig } from "vite";

// The desktop app's half: src/gui.tsx, built to dist/gui-experimental.cjs.
export default defineConfig({ plugins: [gui()] });
