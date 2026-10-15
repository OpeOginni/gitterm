import { build } from "esbuild";
import { mkdir, writeFile, watch } from "node:fs/promises";

async function bundle() {
  const result = await build({
    entryPoints: ["src/main.tsx"],
    bundle: true,
    minify: true,
    write: false,
    outdir: "dist",
    target: ["es2022"],
    loader: { ".png": "dataurl" },
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
  await mkdir("dist", { recursive: true });
  await writeFile(
    "dist/index.html",
    `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#09090b"><title>GitTerm</title>
<style>${css}</style></head><body><div id="app"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
  );
}
await bundle();
if (process.argv.includes("--watch")) {
  for await (const event of watch("src", { recursive: true })) {
    try {
      await bundle();
    } catch (error) {
      console.error(error);
    }
  }
}
