/** Refresh the published validation schema shared by saved V1 and V2 configurations. */
import { fileURLToPath } from "node:url";

const response = await fetch("https://opencode.ai/config.json");
if (!response.ok) throw new Error(`OpenCode schema download failed: ${response.status}`);
const schema = await response.json();
// Zod's JSON Schema reader only resolves local refs. Bundle the upstream model schema.
const modelUrl = "https://models.dev/model-schema.json";
const modelResponse = await fetch(modelUrl);
if (!modelResponse.ok) throw new Error(`Model schema download failed: ${modelResponse.status}`);
const models = JSON.parse(
  JSON.stringify(await modelResponse.json(), (key, value) =>
    key === "$ref" && typeof value === "string" && value.startsWith("#/")
      ? `#/$defs/ModelsDev/${value.slice(2)}`
      : value,
  ),
);
delete models.$id;
schema.$defs.ModelsDev = models;
const bundled = JSON.parse(
  JSON.stringify(schema, (key, value) =>
    key === "$ref" && typeof value === "string" && value.startsWith(`${modelUrl}#/`)
      ? `#/$defs/ModelsDev/${value.slice(modelUrl.length + 2)}`
      : value,
  ),
);
const target = new URL("../packages/schema/src/opencode-config.json", import.meta.url);
await Bun.write(target, `${JSON.stringify(bundled, null, 2)}\n`);
const formatter = Bun.spawn(["bunx", "--no-install", "oxfmt", fileURLToPath(target)], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await formatter.exited) !== 0) throw new Error("OpenCode schema formatting failed");
