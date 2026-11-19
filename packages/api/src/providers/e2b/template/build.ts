import { Sandbox, Template, defaultBuildLogger } from "e2b";
import { createOpencodeServerTemplate } from "./gitterm-opencode-server";
import { createOpencodeServerWithSSHTemplate } from "./gitterm-opencode-server-with-ssh";
import { createT3CodeServerTemplate } from "./gitterm-t3code-server";
import { getLatestOpencodeVersion } from "../../opencode-version";
import { getLatestT3Version } from "../../t3-version";
import { RUNTIME_IMAGE_MAJOR } from "@gitterm/db/runtime-image";
import { GITTERM_CLI_PACKAGE } from "./cli-package";
import "dotenv/config";

const OWNER = "brightoginni123";
const families = [
  { agent: "opencode", name: "gitterm-opencode-server", create: createOpencodeServerTemplate },
  {
    agent: "opencode",
    name: "gitterm-opencode-server-with-ssh",
    create: createOpencodeServerWithSSHTemplate,
  },
  {
    agent: "t3code",
    name: "gitterm-t3code-server",
    create: (opencode: string, t3: string) => createT3CodeServerTemplate(t3, opencode),
  },
  { agent: "sandbox", name: "gitterm-sandbox", create: () => Template().fromBaseImage() },
];
// E2B fixes resources per template. Keep these sizes in sync with the machine profiles in the seed.
const templates = families.flatMap((family) =>
  [
    { suffix: "-sm", cpuCount: 2, memoryMB: 4096 },
    { suffix: "", cpuCount: 4, memoryMB: 8192 },
    { suffix: "-lg", cpuCount: 8, memoryMB: 8192 },
  ].map(({ suffix, ...size }) => ({ ...family, ...size, name: `${family.name}${suffix}` })),
);

/** Other accounts (self-hosted installs) start from these templates, so they must be public. */
async function makePublic(templateId: string, apiKey: string) {
  const res = await fetch(`https://api.e2b.app/v2/templates/${templateId}`, {
    method: "PATCH",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ public: true }),
  });
  if (!res.ok) throw new Error(`Failed to make ${templateId} public: ${res.status}`);
}

async function main() {
  const args = process.argv.slice(2);
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("Set E2B_API_KEY");
  const buildTag = process.env.RUNTIME_BUILD_TAG;
  if (args[0] === "--verify" || args[0] === "--promote") {
    if (args.length !== 1 || !buildTag) throw new Error("Set RUNTIME_BUILD_TAG and pass one mode");
    for (const entry of templates) {
      if (args[0] === "--promote") {
        // The publishing key owns these names. Consumers use the owner-qualified aliases.
        await Template.assignTags(`${entry.name}:${buildTag}`, ["default", RUNTIME_IMAGE_MAJOR], {
          apiKey,
        });
      } else {
        const alias = `${OWNER}/${entry.name}:${buildTag}`;
        console.log(`[e2b-template] starting ${alias} for verification`);
        const sandbox = await Sandbox.create(alias, { apiKey, timeoutMs: 60_000 });
        try {
          const command =
            entry.agent === "sandbox"
              ? "true"
              : `opencode --version && gitterm --version${entry.agent === "t3code" ? " && t3 --version" : ""}`;
          const result = await sandbox.commands.run(command, { timeoutMs: 20_000 });
          const expected = process.env.OPENCODE_VERSION;
          const version = result.stdout
            .split("\n")[0]
            ?.trim()
            .replace(/^opencode v/, "");
          if (entry.agent !== "sandbox" && expected && version !== expected) {
            throw new Error(`${alias} did not start OpenCode ${expected}: ${result.stdout}`);
          }
        } finally {
          await sandbox.kill();
        }
      }
      console.log(`[e2b-template] ${args[0].slice(2)} ${entry.name}:${buildTag}`);
    }
    return;
  }

  const agent = args[0] === "--agent" ? args[1] : undefined;
  if (
    args[0] === "--agent" &&
    (args.length !== 2 || !["opencode", "t3code", "sandbox"].includes(agent ?? ""))
  ) {
    throw new Error("Use --agent opencode, --agent t3code, or --agent sandbox");
  }
  // No args builds everything; --agent selects all sizes for one agent.
  // Explicit template names remain supported for local builds.
  const requested = agent ? [] : args;
  const unknown = requested.filter((name) => !templates.some((entry) => entry.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown template(s): ${unknown.join(", ")}. Available: ${templates.map((entry) => entry.name).join(", ")}`,
    );
  }
  const selected = templates.filter((entry) =>
    agent ? entry.agent === agent : !requested.length || requested.includes(entry.name),
  );
  // CI passes exact versions already checked by the release plan. Local builds resolve their own.
  const [opencode, t3] = await Promise.all([
    selected.some((entry) => entry.agent !== "sandbox")
      ? buildTag && process.env.OPENCODE_VERSION
        ? process.env.OPENCODE_VERSION
        : getLatestOpencodeVersion()
      : "",
    selected.some((entry) => entry.agent === "t3code")
      ? buildTag && process.env.T3_VERSION
        ? process.env.T3_VERSION
        : getLatestT3Version()
      : "",
  ]);
  if (opencode) console.log(`[e2b-template] OpenCode ${opencode}, ${GITTERM_CLI_PACKAGE}`);
  if (t3) console.log(`[e2b-template] T3 Code ${t3}`);

  for (const entry of selected) {
    const alias = `${entry.name}:${buildTag ?? "default"}`;
    console.log(`[e2b-template] building ${alias} (${entry.cpuCount} vCPU, ${entry.memoryMB} MB)`);
    const built = await Template.build(entry.create(opencode, t3), alias, {
      cpuCount: entry.cpuCount,
      memoryMB: entry.memoryMB,
      ...(buildTag ? {} : { tags: [RUNTIME_IMAGE_MAJOR] }),
      onBuildLogs: defaultBuildLogger(),
      apiKey,
    });
    if (buildTag) await makePublic(built.templateId, apiKey);
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
