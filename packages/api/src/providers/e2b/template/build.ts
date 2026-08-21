import { Template, defaultBuildLogger, type TemplateClass } from "e2b";
import { createOpencodeServerTemplate } from "./gitterm-opencode-server";
import { createOpencodeServerWithSSHTemplate } from "./gitterm-opencode-server-with-ssh";
import { createT3CodeServerTemplate } from "./gitterm-t3code-server";
import { getLatestOpencodeVersion } from "../../opencode-version";
import { getLatestT3Version } from "../../t3-version";
import "dotenv/config";

async function main() {
  const [opencodeVersion, t3Version] = await Promise.all([
    getLatestOpencodeVersion(),
    getLatestT3Version(),
  ]);
  console.log(`[e2b-template] pinning opencode version ${opencodeVersion}`);
  console.log(`[e2b-template] pinning t3 version ${t3Version}`);

  const templates: Array<{
    name: string;
    template: TemplateClass;
    cpuCount: number;
    memoryMB: number;
  }> = [
    {
      name: "gitterm-opencode-server",
      template: createOpencodeServerTemplate(opencodeVersion),
      cpuCount: 2,
      memoryMB: 2048,
    },
    // Larger variant, selectable per workspace via e2b machine options.
    {
      name: "gitterm-opencode-server-lg",
      template: createOpencodeServerTemplate(opencodeVersion),
      cpuCount: 4,
      memoryMB: 8192,
    },
    {
      name: "gitterm-opencode-server-with-ssh",
      template: createOpencodeServerWithSSHTemplate(opencodeVersion),
      cpuCount: 4,
      memoryMB: 4096,
    },
    {
      name: "gitterm-t3code-server",
      template: createT3CodeServerTemplate(t3Version, opencodeVersion),
      cpuCount: 2,
      memoryMB: 2048,
    },
  ];

  // `bun run e2b:build [name...]` — no args builds everything.
  const requested = process.argv.slice(2);
  const unknown = requested.filter((name) => !templates.some((entry) => entry.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown template(s): ${unknown.join(", ")}. Available: ${templates.map((entry) => entry.name).join(", ")}`,
    );
  }
  const selected =
    requested.length > 0 ? templates.filter((entry) => requested.includes(entry.name)) : templates;

  for (const entry of selected) {
    console.log(
      `[e2b-template] building ${entry.name} (${entry.cpuCount} vCPU, ${entry.memoryMB} MB)`,
    );
    const built = await Template.build(entry.template, entry.name, {
      cpuCount: entry.cpuCount,
      memoryMB: entry.memoryMB,
      onBuildLogs: defaultBuildLogger(),
      apiKey: process.env.E2B_API_KEY,
    });
    console.log(built);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
