import { fileURLToPath } from "node:url";
import path from "node:path";

/** A worker source file an admin can download to deploy the worker themselves. */
export interface CloudflareWorkerFile {
  /** Filename for the download (no directories). */
  name: string;
  /** Relative location inside the worker project, for display. */
  path: string;
  contents: string;
}

/**
 * Read the deployable worker files so the admin UI can offer them as a ZIP
 * download (avoids cloning the repo to run `wrangler deploy`).
 *
 * Note: the worker is container-backed (Durable Object + container app +
 * migration), so it must be deployed with `wrangler deploy` using these files -
 * dropping a single file into the Cloudflare dashboard is not sufficient.
 */
export async function getCloudflareWorkerFiles(): Promise<
  CloudflareWorkerFile[]
> {
  const base = fileURLToPath(
    new URL("./sandbox-worker/", import.meta.url).href,
  );
  const targets: Array<{ name: string; path: string; rel: string }> = [
    { name: "package.json", path: "package.json", rel: "package.json" },
    { name: "wrangler.jsonc", path: "wrangler.jsonc", rel: "wrangler.jsonc" },
    { name: "index.ts", path: "src/index.ts", rel: "src/index.ts" },
    { name: "Dockerfile", path: "Dockerfile", rel: "Dockerfile" },
  ];

  return Promise.all(
    targets.map(async (target) => ({
      name: target.name,
      path: target.path,
      contents: await Bun.file(path.join(base, target.rel)).text(),
    })),
  );
}

/**
 * Minimal manual setup instructions shown on the Cloudflare provider page.
 * Admins download the worker files (ZIP), deploy with Wrangler, and paste the
 * resulting Worker URL + Internal API Key back into the provider config.
 */
export function getCloudflareManualSetupInstructions(): {
  steps: string[];
  command: string;
} {
  return {
    command:
      "npm install\nnpx wrangler deploy\nnpx wrangler secret put INTERNAL_API_KEY",
    steps: [
      "Download the setup ZIP below and unzip it.",
      "In the unzipped folder, run the commands below (install pulls the worker dependency). When `secret put` prompts, enter a strong value for INTERNAL_API_KEY.",
      "Paste the printed Worker URL and the same INTERNAL_API_KEY value into the fields below, then enable the provider.",
    ],
  };
}
