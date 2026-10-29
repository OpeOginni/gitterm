import { Template, defaultBuildLogger, type TemplateClass } from "e2b";
import { createOpencodeServerTemplate } from "./gitterm-opencode-server";
import { createOpencodeServerWithSSHTemplate } from "./gitterm-opencode-server-with-ssh";
import { createT3CodeServerTemplate } from "./gitterm-t3code-server";
import { getLatestOpencodeVersion } from "../../opencode-version";
import { getLatestT3Version } from "../../t3-version";
import "dotenv/config";

async function main() {
  const args = process.argv.slice(2);
  const agent = args[0] === "--agent" ? args[1] : undefined;
  if (
    args[0] === "--agent" &&
    (args.length !== 2 || !["opencode", "t3code"].includes(agent ?? ""))
  ) {
    throw new Error("Use --agent opencode or --agent t3code");
  }
  const [opencodeVersion, t3Version] = await Promise.all([
    getLatestOpencodeVersion(),
    agent === "opencode" ? undefined : getLatestT3Version(),
  ]);
  if (opencodeVersion) console.log(`[e2b-template] pinning opencode version ${opencodeVersion}`);
  if (t3Version) console.log(`[e2b-template] pinning t3 version ${t3Version}`);

  const baseTemplates: Array<{ name: string; template: TemplateClass }> = [];
  if (agent !== "t3code")
    baseTemplates.push(
      { name: "gitterm-opencode-server", template: createOpencodeServerTemplate(opencodeVersion) },
      {
        name: "gitterm-opencode-server-with-ssh",
        template: createOpencodeServerWithSSHTemplate(opencodeVersion),
      },
    );
  if (t3Version)
    baseTemplates.push({
      name: "gitterm-t3code-server",
      template: createT3CodeServerTemplate(t3Version, opencodeVersion),
    });
  // E2B fixes resources per template, so each machine profile size is its own
  // template named `<base><suffix>`. Must match the E2B machine profiles in the seed.
  // Large is capped at the account's maximum supported memory.
  const sizes = [
    { suffix: "-sm", cpuCount: 2, memoryMB: 4096 },
    { suffix: "", cpuCount: 4, memoryMB: 8192 },
    { suffix: "-lg", cpuCount: 8, memoryMB: 8192 },
  ];
  const templates = baseTemplates.flatMap((base) =>
    sizes.map((size) => ({
      name: `${base.name}${size.suffix}`,
      template: base.template,
      cpuCount: size.cpuCount,
      memoryMB: size.memoryMB,
    })),
  );

  // No args builds everything; --agent selects all sizes for one agent.
  // Explicit template names remain supported for local builds.
  const requested = agent ? [] : args;
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
