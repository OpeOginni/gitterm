import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Run after build:sdk/build:bots. Packs and installs only; never publishes or commits.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumer = await mkdtemp(
  join(process.env.GITTERM_SMOKE_ROOT ?? tmpdir(), "gitterm-consumer-"),
);
function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
const tarballs: string[] = [];
for (const directory of ["sdk", "bot", "slack-bot", "discord-bot"]) {
  const manifest = JSON.parse(
    await readFile(join(root, "packages", directory, "package.json"), "utf8"),
  );
  // Match release tooling: npm packs the SDK; Bun rewrites workspace runtime dependencies
  // for bots. SDK devDependencies include private, intentionally unversioned packages.
  const packed =
    directory === "sdk"
      ? JSON.parse(
          run(
            "npm",
            ["pack", "--ignore-scripts", "--json", "--pack-destination", consumer],
            join(root, "packages", directory),
          ),
        )[0].filename
      : run(
          "bun",
          ["pm", "pack", "--ignore-scripts", "--quiet", "--destination", consumer],
          join(root, "packages", directory),
        );
  const tarball = resolve(consumer, packed.split("\n").at(-1)!);
  const packaged = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"], consumer));
  if (directory !== "sdk" && packaged.dependencies["@gitterm/sdk"] !== "^0.9.0") {
    throw new Error(`${manifest.name} does not require the new SDK`);
  }
  tarballs.push(tarball);
}
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify({ name: "gitterm-clean-consumer", private: true, type: "module" }),
);
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], consumer);
await writeFile(
  join(consumer, "smoke.mjs"),
  `
import assert from 'node:assert/strict';
import { createGittermClient } from '@gitterm/sdk';
import { createBot, downloadImage } from '@gitterm/bot';
import * as slack from '@gitterm/slack-bot';
import * as discord from '@gitterm/discord-bot';
const client = createGittermClient({ token: 'gt_smoke', serverUrl: 'https://example.com' });
for (const value of [client.bots.self, client.bots.acquireLease, client.bots.releaseLease,
  client.integrations.connections.resolve, createBot, downloadImage]) assert.equal(typeof value, 'function');
assert.ok(Object.keys(slack).length); assert.ok(Object.keys(discord).length);
console.log('Packed SDK and Slack/Discord packages import successfully in a clean npm consumer.');
`,
);
console.log(run("node", ["smoke.mjs"], consumer));
console.log(`Consumer retained for inspection: ${consumer}`);
