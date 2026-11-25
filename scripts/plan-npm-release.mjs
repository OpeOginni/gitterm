import { appendFileSync, readFileSync } from "node:fs";

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function isNewer(version, latest) {
  const previous = latest.split(".").map(BigInt);
  for (const [i, part] of version.split(".").map(BigInt).entries()) {
    if (part !== previous[i]) return part > previous[i];
  }
  return false;
}

const packages = [];
// Publish the plugin before the CLI that installs it.
for (const pkg of ["agent-runtime", "sdk", "opencode", "cli"]) {
  const manifest = new URL(`../packages/${pkg}/package.json`, import.meta.url);
  const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
  if (name !== `@gitterm/${pkg}` || !stable.test(version)) {
    throw new Error(`Unexpected name or version in packages/${pkg}/package.json`);
  }
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`npm registry returned HTTP ${response.status} for ${name}`);
  }
  const info = response.ok ? await response.json() : {};
  const latest = info["dist-tags"]?.latest ?? null;
  if (latest === version) continue;
  if (latest && (!stable.test(latest) || !isNewer(version, latest))) {
    throw new Error(`${name}@${version} would not advance npm latest (${latest})`);
  }
  const exists = Object.hasOwn(info.versions ?? {}, version);
  if (exists && info["dist-tags"]?.candidate !== version) {
    throw new Error(`${name}@${version} already exists outside the candidate channel`);
  }
  packages.push({ package: pkg, version, latest, exists });
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `packages=${JSON.stringify(packages)}\n`);
}
console.log(JSON.stringify(packages, null, 2));
