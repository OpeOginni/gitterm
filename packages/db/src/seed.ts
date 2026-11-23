import { db, eq, and } from "./index";
import {
  agentType,
  cloudProvider,
  image,
  machineProfile,
  region,
  type CloudProvidersshAccessSupport,
  type ImageProviderMetadata,
  type ProviderSettlement,
} from "./schema/cloud";
import { modelProvider } from "./schema/model-credentials";
import { providerType, providerConfigField } from "./schema/provider-config";
import { PROVIDER_DEFINITIONS } from "@gitterm/schema";
import { MODEL_PROVIDERS } from "@gitterm/schema/model-providers";
import { removeRetiredImageProviders, RETIRED_IMAGE_PROVIDERS } from "./seed-image-cleanup";
import { RUNTIME_IMAGE_MAJOR } from "./runtime-image";
import cliPackage from "../../cli/package.json" with { type: "json" };
import { npmInstallCommand } from "@gitterm/schema/agent-install";
import { PI_INSTALL_COMMAND } from "@gitterm/schema/pi";

/**
 * Seed data definitions
 * These define the default providers, agent types, images, and regions.
 * The seed is idempotent - it will:
 * - Add new items that don't exist
 * - Update seeded metadata/config fields when definitions change
 * - Preserve enablement flags managed in admin
 * - Never delete existing items
 */

const hasSameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const seedCloudProviders: Array<{
  name: string;
  /** A former name; an existing row with it is renamed instead of duplicated. */
  renamedFrom?: string;
  providerKey: string;
  isEnabled: boolean;
  isSandbox?: boolean;
  preferredDefault?: boolean;
  autoPersistent?: boolean;
  supportsPersistence?: boolean;
  machineSelectionPolicy?: { mode: "standard" | "profiles" };
  supportsRegions: boolean;
  allowUserRegionSelection?: boolean;
  supportServerOnly?: boolean;
  location?: string;
  sshAccessSupport?: CloudProvidersshAccessSupport;
  creationSettlement?: ProviderSettlement;
  stopSettlement?: ProviderSettlement;
  restartSettlement?: ProviderSettlement;
  terminationSettlement?: ProviderSettlement;
}> = [
  {
    name: "Railway",
    providerKey: "railway",
    isEnabled: false,
    supportsRegions: true,
    machineSelectionPolicy: { mode: "standard" },
    sshAccessSupport: {
      supported: true,
      transportKind: "managed-ssh",
      label: "Managed SSH bridge",
      description: "Connect through the Gitterm-managed SSH bridge for Railway workspaces.",
    },
    creationSettlement: "webhook" as ProviderSettlement,
    stopSettlement: "webhook" as ProviderSettlement,
    restartSettlement: "webhook" as ProviderSettlement,
    terminationSettlement: "webhook" as ProviderSettlement,
  },
  // AWS is intentionally NOT seeded. Each AWS region is its own cloud_provider
  // row, created by admins via `aws.createRegionProvider` (Add AWS Region in
  // the providers admin UI). Seeding a generic "AWS" row with multiple regions
  // attached produced ambiguous state - region resolution at deploy time falls
  // back to a shared default config and silently lands every workspace in the
  // first seeded region (typically us-east-1) regardless of which AWS provider
  // was picked. Admins must explicitly add the regions they want to use.
  {
    name: "E2B",
    providerKey: "e2b",
    isEnabled: false,
    isSandbox: true,
    preferredDefault: false,
    autoPersistent: true,
    supportsRegions: false,
    machineSelectionPolicy: { mode: "profiles" },
    supportServerOnly: true,
    location: "US",
    sshAccessSupport: {
      supported: false,
      label: "Not supported",
      description: "Workspaces on this provider do not offer SSH editor access.",
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "webhook" as ProviderSettlement,
    restartSettlement: "webhook" as ProviderSettlement,
    terminationSettlement: "webhook" as ProviderSettlement,
  },
  {
    name: "Daytona",
    providerKey: "daytona",
    isEnabled: false,
    isSandbox: true,
    autoPersistent: true,
    supportsRegions: true,
    machineSelectionPolicy: { mode: "profiles" },
    // A Daytona API key is bound to a single region, so end users can't pick a
    // region - the admin-configured defaultTargetRegion is always used.
    allowUserRegionSelection: false,
    supportServerOnly: true,
    sshAccessSupport: {
      supported: false,
      label: "Not supported",
      description: "Workspaces on this provider do not offer SSH editor access.",
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "webhook" as ProviderSettlement,
    restartSettlement: "webhook" as ProviderSettlement,
    terminationSettlement: "webhook" as ProviderSettlement,
  },
  {
    name: "Vercel Sandbox",
    providerKey: "vercel",
    isEnabled: false,
    isSandbox: true,
    autoPersistent: true,
    supportsRegions: false,
    machineSelectionPolicy: { mode: "profiles" },
    supportServerOnly: true,
    sshAccessSupport: {
      supported: false,
      label: "Not supported",
      description: "Vercel Sandbox does not currently expose SSH editor access.",
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "immediate" as ProviderSettlement,
    restartSettlement: "immediate" as ProviderSettlement,
    terminationSettlement: "immediate" as ProviderSettlement,
  },
  {
    name: "Boat",
    renamedFrom: "Ascii Box",
    providerKey: "boat",
    isEnabled: false,
    isSandbox: true,
    // The default provider when a user hasn't picked one: cheapest for users and for us.
    preferredDefault: true,
    autoPersistent: true,
    supportsRegions: false,
    machineSelectionPolicy: { mode: "profiles" },
    supportServerOnly: true,
    location: "EU",
    sshAccessSupport: {
      supported: false,
      label: "Not supported",
      description: "Workspaces on this provider do not offer SSH editor access.",
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "immediate" as ProviderSettlement,
    restartSettlement: "immediate" as ProviderSettlement,
    terminationSettlement: "immediate" as ProviderSettlement,
  },
  {
    name: "exe.dev",
    providerKey: "exedev",
    isEnabled: false,
    isSandbox: true,
    autoPersistent: true,
    supportsRegions: false,
    machineSelectionPolicy: { mode: "profiles" },
    supportServerOnly: true,
    sshAccessSupport: {
      supported: false,
      label: "Not supported",
      description: "Workspaces on this provider do not offer SSH editor access.",
    },
    creationSettlement: "immediate" as ProviderSettlement,
    stopSettlement: "immediate" as ProviderSettlement,
    restartSettlement: "immediate" as ProviderSettlement,
    terminationSettlement: "immediate" as ProviderSettlement,
  },
];

const seedAgentTypes = [
  {
    key: "opencode-ttyd",
    name: "OpenCode (TTYD)",
    provisionerKey: "opencode",
    serverOnly: false,
    description: "Run the OpenCode TUI in a browser-based terminal. No local client needed.",
    // Previous names used in older seeds. Used to migrate existing rows to the new name.
    // Rename legacy rows first so bare "OpenCode" becomes TTYD before the server agent is seeded.
    aliases: ["OpenCode Terminal", "OpenCode"],
  },
  {
    key: "opencode",
    name: "OpenCode",
    provisionerKey: "opencode",
    serverOnly: true,
    description:
      "Run a remote OpenCode server. Use it from your local TUI, Desktop app, or directly in the browser.",
    aliases: ["OpenCode Server"],
  },
  {
    key: "t3code",
    name: "T3Code",
    provisionerKey: "t3code",
    serverOnly: true,
    description:
      "Run a T3 Code server driving Claude Code, Codex, and OpenCode. Pair it with the T3 web or mobile app via a one-time pairing link.",
    aliases: ["T3Code Server"],
  },
  {
    key: "pi",
    name: "Pi",
    provisionerKey: "pi",
    serverOnly: false,
    description:
      "Run the Pi coding agent in a browser terminal. Sessions keep running when you close the tab.",
    aliases: [],
  },
];

/**
 * Providers without an image install the CLI when a workspace starts. Pin it below the next
 * breaking release of the CLI this platform ships with (the next minor while it's 0.x), so
 * npm installs the newest compatible one and never a CLI that needs a newer server.
 */
const [cliMajor = 0, cliMinor = 0] = cliPackage.version.split(".").map(Number);
const GITTERM_CLI = `'@gitterm/cli@<${cliMajor === 0 ? `0.${cliMinor + 1}` : cliMajor + 1}.0'`;

/**
 * How each agent installs on a provider without a prebuilt image: the default everywhere.
 * An admin can set a prebuilt `snapshot` (or an E2B `templateId`) per image instead.
 */
const INSTALL_OPENCODE = npmInstallCommand(["@opencode/cli@2", GITTERM_CLI]);
const INSTALL_T3CODE = npmInstallCommand([
  "t3",
  "@anthropic-ai/claude-code",
  "@openai/codex",
  "@opencode/cli@2",
  GITTERM_CLI,
]);

/** E2B templates GitTerm used to seed. Images still pointing at one go back to the default. */
const SEEDED_E2B_TEMPLATE = /^brightoginni123\/gitterm-/;

/**
 * The seed owns an image's provider settings, except the prebuilt an admin chose: a
 * `snapshot`, or an E2B `templateId` that isn't one GitTerm seeded.
 */
function keepPrebuilt(
  existing: ImageProviderMetadata | null | undefined,
  seeded: ImageProviderMetadata,
): ImageProviderMetadata {
  const merged: Record<string, Record<string, unknown>> = { ...seeded } as never;
  for (const [provider, options] of Object.entries(existing ?? {})) {
    if (!options || typeof options !== "object") continue;
    const { snapshot, templateId } = options as { snapshot?: unknown; templateId?: unknown };
    const kept = {
      ...(typeof snapshot === "string" && snapshot ? { snapshot } : {}),
      ...(typeof templateId === "string" && templateId && !SEEDED_E2B_TEMPLATE.test(templateId)
        ? { templateId }
        : {}),
    };
    if (Object.keys(kept).length) merged[provider] = { ...merged[provider], ...kept };
  }
  return merged as ImageProviderMetadata;
}

/** E2B-only 4 vCPU template, superseded by the `-sm`/`-lg` size templates. */
const RETIRED_IMAGE_NAMES = ["gitterm-opencode-server-lg"];

const seedImages = [
  {
    name: "gitterm-opencode",
    imageId: `opeoginni/gitterm-opencode:${RUNTIME_IMAGE_MAJOR}`,
    agentTypeName: "OpenCode (TTYD)",
    providerMetadata: {
      railway: {},
      daytona: {
        image: `opeoginni/gitterm-opencode-server:${RUNTIME_IMAGE_MAJOR}`,
        resources: { cpu: 2, memory: 4 },
        editorResources: { cpu: 4, memory: 8 },
      },
      aws: {
        cpu: 4096,
        memory: 16384,
        containerPort: 7681,
        healthCheckPath: "/",
      },
    },
  },
  {
    name: "gitterm-opencode-server",
    imageId: `opeoginni/gitterm-opencode-server:${RUNTIME_IMAGE_MAJOR}`,
    agentTypeName: "OpenCode",
    providerMetadata: {
      railway: {},
      e2b: { setupCommands: [INSTALL_OPENCODE] },
      daytona: {
        image: `opeoginni/gitterm-opencode-server:${RUNTIME_IMAGE_MAJOR}`,
        resources: { cpu: 2, memory: 4 },
        editorResources: { cpu: 4, memory: 8 },
      },
      aws: {
        cpu: 4096,
        memory: 16384,
        containerPort: 7681,
        healthCheckPath: "/",
      },
      vercel: {
        runtime: "node22" as const,
        setupCommands: [INSTALL_OPENCODE],
        vcpus: 2,
      },
      boat: {
        setupCommands: [INSTALL_OPENCODE],
      },
    },
  },
  {
    name: "gitterm-t3code-server",
    imageId: `opeoginni/gitterm-t3code-server:${RUNTIME_IMAGE_MAJOR}`,
    agentTypeName: "T3Code",
    providerMetadata: {
      railway: {},
      e2b: { setupCommands: [INSTALL_T3CODE] },
      daytona: {
        image: `opeoginni/gitterm-t3code-server:${RUNTIME_IMAGE_MAJOR}`,
        resources: { cpu: 2, memory: 4 },
        editorResources: { cpu: 4, memory: 8 },
      },
      aws: {
        cpu: 4096,
        memory: 16384,
        containerPort: 7681,
        healthCheckPath: "/",
      },
      vercel: {
        runtime: "node22" as const,
        setupCommands: [INSTALL_T3CODE],
        vcpus: 2,
      },
      boat: {
        setupCommands: [INSTALL_T3CODE],
      },
      exedev: {
        setupCommands: [INSTALL_T3CODE],
      },
    },
  },
  // Pi installs on a Node 24 image, or on providers' own runtimes. No E2B template yet.
  {
    name: "gitterm-pi",
    imageId: "node:24-bookworm",
    agentTypeName: "Pi",
    providerMetadata: {
      e2b: { setupCommands: [PI_INSTALL_COMMAND] },
      daytona: {
        image: "node:24-bookworm",
        resources: { cpu: 2, memory: 4 },
        setupCommands: [PI_INSTALL_COMMAND],
      },
      vercel: { runtime: "node24" as const, setupCommands: [PI_INSTALL_COMMAND], vcpus: 2 },
      boat: { setupCommands: [PI_INSTALL_COMMAND] },
      exedev: { image: "node:24-bookworm", setupCommands: [PI_INSTALL_COMMAND] },
    },
  },
];

/**
 * Each provider's machine sizes. `vcpus`/`memoryGb` must match what the provider
 * actually provisions for `providerOptions`: users see them, and managed free
 * plans are limited to a provider's smallest enabled size.
 */
const seedMachineProfiles: Array<{
  providerName: string;
  key: string;
  name: string;
  vcpus: number;
  memoryGb: number;
  providerOptions: Record<string, unknown>;
  isDefault: boolean;
}> = [
  // E2B fixes resources per template. Without an admin's templates, workspaces start from
  // E2B's base template; admins add profiles for their own sized templates (templateSuffix).
  {
    providerName: "E2B",
    key: "standard",
    name: "Standard",
    vcpus: 2,
    memoryGb: 0.5,
    providerOptions: {},
    isDefault: true,
  },
  {
    providerName: "Boat",
    key: "small",
    name: "Small",
    vcpus: 2,
    memoryGb: 4,
    providerOptions: { size: "small" },
    isDefault: false,
  },
  {
    providerName: "Boat",
    key: "standard",
    name: "Standard",
    vcpus: 4,
    memoryGb: 8,
    providerOptions: { size: "default" },
    isDefault: true,
  },
  {
    providerName: "Boat",
    key: "large",
    name: "Large",
    vcpus: 8,
    memoryGb: 16,
    providerOptions: { size: "large" },
    isDefault: false,
  },
  ...(
    [
      ["small", "Small", 1, 2, false],
      ["standard", "Standard", 2, 4, true],
      ["large", "Large", 4, 8, false],
    ] as const
  ).flatMap(([key, name, cpu, memory, isDefault]) => [
    {
      providerName: "Daytona",
      key,
      name,
      vcpus: cpu,
      memoryGb: memory,
      // SSH workspaces use editorResources; keep them the same size.
      providerOptions: { resources: { cpu, memory }, editorResources: { cpu, memory } },
      isDefault,
    },
    {
      providerName: "Vercel Sandbox",
      key,
      name,
      vcpus: cpu,
      // Vercel allocates 2 GB per vCPU.
      memoryGb: cpu * 2,
      providerOptions: { vcpus: cpu },
      isDefault,
    },
    {
      providerName: "exe.dev",
      key,
      name,
      vcpus: cpu,
      memoryGb: memory,
      providerOptions: { cpu, memory: `${memory}GB`, disk: "20GB" },
      isDefault,
    },
  ]),
];

const seedProviderTypes = PROVIDER_DEFINITIONS;

const seedRegions = [
  // Railway regions
  {
    name: "US West Metal",
    location: "California, USA",
    externalRegionIdentifier: "us-west2",
    providerName: "Railway",
  },
  {
    name: "US East Metal",
    location: "Virginia, USA",
    externalRegionIdentifier: "us-east4-eqdc4a",
    providerName: "Railway",
  },
  {
    name: "EU West Metal",
    location: "Amsterdam, Netherlands",
    externalRegionIdentifier: "europe-west4-drams3a",
    providerName: "Railway",
  },
  {
    name: "Southeast Asia Metal",
    location: "Singapore",
    externalRegionIdentifier: "asia-southeast1-eqsg3a",
    providerName: "Railway",
  },
  // AWS regions are NOT seeded. Each AWS region is its own cloud_provider row,
  // created by admins via `aws.createRegionProvider` which attaches the
  // matching region row at creation time.
  // Daytona Regions
  {
    name: "Europe",
    location: "",
    externalRegionIdentifier: "eu",
    providerName: "Daytona",
  },
  {
    name: "United States",
    location: "",
    externalRegionIdentifier: "us",
    providerName: "Daytona",
  },
];

// =========================================================================
// Model Providers Seed Data
// =========================================================================

const modelProviderOAuthConfig: Record<string, Record<string, string>> = {
  "github-copilot": {
    clientId: "Iv1.b507a08c87ecfe98",
    deviceCodeUrl: "https://github.com/login/device/code",
    accessTokenUrl: "https://github.com/login/oauth/access_token",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
  },
};

/**
 * Seed the database with initial data
 * This is idempotent - safe to run multiple times
 */
export async function seedDatabase(): Promise<void> {
  console.log("[seed] Starting database seed...");

  // =========================================================================
  // Seed Cloud Providers
  // =========================================================================
  console.log("[seed] Seeding cloud providers...");
  const providerMap = new Map<string, string>(); // name -> id

  for (const provider of seedCloudProviders) {
    const existing =
      (await db.query.cloudProvider.findFirst({
        where: eq(cloudProvider.name, provider.name),
      })) ??
      (provider.renamedFrom
        ? await db.query.cloudProvider.findFirst({
            where: eq(cloudProvider.name, provider.renamedFrom),
          })
        : undefined);

    if (existing) {
      const updates: Partial<typeof cloudProvider.$inferInsert> = {};
      const targetIsSandbox = provider.isSandbox ?? false;
      const targetAutoPersistent = provider.autoPersistent ?? false;
      const targetSupportsPersistence = provider.supportsPersistence ?? true;
      const targetSupportsRegions = provider.supportsRegions ?? true;
      const targetAllowUserRegionSelection = provider.allowUserRegionSelection ?? true;
      const targetSupportServerOnly = provider.supportServerOnly ?? false;
      const targetProviderCreationSettlement = provider.creationSettlement ?? "webhook";
      const targetProviderStopSettlement = provider.stopSettlement ?? "webhook";
      const targetProviderRestartSettlement = provider.restartSettlement ?? "webhook";
      const targetProviderTerminationSettlement = provider.terminationSettlement ?? "webhook";
      const targetsshAccessSupport = provider.sshAccessSupport ?? {};

      if (existing.name !== provider.name) {
        updates.name = provider.name;
      }

      if (existing.providerKey !== provider.providerKey) {
        updates.providerKey = provider.providerKey;
      }

      if (existing.isSandbox !== targetIsSandbox) {
        updates.isSandbox = targetIsSandbox;
      }

      if (
        provider.preferredDefault !== undefined &&
        existing.preferredDefault !== provider.preferredDefault
      ) {
        updates.preferredDefault = provider.preferredDefault;
      }

      if (existing.autoPersistent !== targetAutoPersistent) {
        updates.autoPersistent = targetAutoPersistent;
      }

      if (existing.supportsPersistence !== targetSupportsPersistence) {
        updates.supportsPersistence = targetSupportsPersistence;
      }

      if (existing.supportsRegions !== targetSupportsRegions) {
        updates.supportsRegions = targetSupportsRegions;
      }

      if (existing.allowUserRegionSelection !== targetAllowUserRegionSelection) {
        updates.allowUserRegionSelection = targetAllowUserRegionSelection;
      }

      if (existing.supportServerOnly !== targetSupportServerOnly) {
        updates.supportServerOnly = targetSupportServerOnly;
      }

      if (existing.creationSettlement !== targetProviderCreationSettlement) {
        updates.creationSettlement = targetProviderCreationSettlement;
      }

      if (existing.stopSettlement !== targetProviderStopSettlement) {
        updates.stopSettlement = targetProviderStopSettlement;
      }

      if (existing.restartSettlement !== targetProviderRestartSettlement) {
        updates.restartSettlement = targetProviderRestartSettlement;
      }

      if (existing.terminationSettlement !== targetProviderTerminationSettlement) {
        updates.terminationSettlement = targetProviderTerminationSettlement;
      }

      if (!hasSameJson(existing.sshAccessSupport, targetsshAccessSupport)) {
        updates.sshAccessSupport = targetsshAccessSupport;
      }

      // Machine selection policy is admin-owned once the provider exists.
      if (existing.location === null && provider.location) {
        updates.location = provider.location;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(cloudProvider)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(cloudProvider.id, existing.id));

        console.log(`[seed]   Updated provider metadata for "${provider.name}"`);
      } else {
        console.log(`[seed]   Provider "${provider.name}" already exists`);
      }

      providerMap.set(provider.name, existing.id);
    } else {
      const [created] = await db
        .insert(cloudProvider)
        .values({
          name: provider.name,
          providerKey: provider.providerKey,
          isEnabled: provider.isEnabled,
          isSandbox: provider.isSandbox ?? false,
          preferredDefault: provider.preferredDefault ?? false,
          autoPersistent: provider.autoPersistent ?? false,
          supportsPersistence: provider.supportsPersistence ?? true,
          supportsRegions: provider.supportsRegions,
          allowUserRegionSelection: provider.allowUserRegionSelection ?? true,
          supportServerOnly: provider.supportServerOnly ?? false,
          location: provider.location ?? null,
          sshAccessSupport: provider.sshAccessSupport ?? {},
          machineSelectionPolicy: provider.machineSelectionPolicy ?? { mode: "standard" },
          creationSettlement: provider.creationSettlement ?? "webhook",
          stopSettlement: provider.stopSettlement ?? "webhook",
          restartSettlement: provider.restartSettlement ?? "webhook",
          terminationSettlement: provider.terminationSettlement ?? "webhook",
        })
        .returning();
      console.log(`[seed]   Created provider "${provider.name}"`);
      providerMap.set(provider.name, created!.id);
    }
  }

  console.log("[seed] Seeding machine profiles...");
  for (const profile of seedMachineProfiles) {
    const cloudProviderId = providerMap.get(profile.providerName);
    if (!cloudProviderId) continue;
    const profileValues = {
      key: profile.key,
      name: profile.name,
      description: null,
      vcpus: profile.vcpus,
      memoryGb: profile.memoryGb,
      providerOptions: profile.providerOptions,
    };
    const existing = await db.query.machineProfile.findFirst({
      where: and(
        eq(machineProfile.cloudProviderId, cloudProviderId),
        eq(machineProfile.key, profile.key),
      ),
    });
    if (existing) {
      // Default and enablement are admin-owned; only refresh the size definition.
      await db
        .update(machineProfile)
        .set({ ...profileValues, updatedAt: new Date() })
        .where(eq(machineProfile.id, existing.id));
    } else {
      await db.insert(machineProfile).values({
        ...profileValues,
        cloudProviderId,
        isDefault: profile.isDefault,
        isEnabled: true,
      });
    }
  }
  // Sizes GitTerm used to seed for E2B, which need its templates. Ones an admin didn't change
  // are turned off; an admin who builds sized templates sets them up again.
  const e2bProviderId = providerMap.get("E2B");
  for (const [key, templateSuffix] of [
    ["small", "-sm"],
    ["large", "-lg"],
  ] as const) {
    if (!e2bProviderId) break;
    const retired = await db.query.machineProfile.findFirst({
      where: and(eq(machineProfile.cloudProviderId, e2bProviderId), eq(machineProfile.key, key)),
    });
    if (retired?.isEnabled && retired.providerOptions?.templateSuffix === templateSuffix) {
      await db
        .update(machineProfile)
        .set({ isEnabled: false, isDefault: false, updatedAt: new Date() })
        .where(eq(machineProfile.id, retired.id));
      console.log(`[seed]   Turned off the E2B "${key}" size, which needs your own templates`);
    }
  }

  // =========================================================================
  // Seed Agent Types
  // =========================================================================
  console.log("[seed] Seeding agent types...");
  const agentTypeMap = new Map<string, string>(); // name -> id

  for (const agent of seedAgentTypes) {
    // Look up by current name first, then fall back to any known previous names
    // so we can rename existing rows in place (e.g. "OpenCode Terminal" -> "OpenCode (TTYD)").
    let existing = await db.query.agentType.findFirst({
      where: eq(agentType.name, agent.name),
    });

    if (!existing && agent.aliases.length > 0) {
      for (const alias of agent.aliases) {
        const aliasRow = await db.query.agentType.findFirst({
          where: eq(agentType.name, alias),
        });
        if (aliasRow) {
          existing = aliasRow;
          console.log(`[seed]   Renaming agent type "${alias}" -> "${agent.name}"`);
          break;
        }
      }
    }

    if (existing) {
      const [updated] = await db
        .update(agentType)
        .set({
          key: agent.key,
          name: agent.name,
          description: agent.description,
          provisionerKey: agent.provisionerKey,
          serverOnly: agent.serverOnly,
          updatedAt: new Date(),
        })
        .where(eq(agentType.id, existing.id))
        .returning();
      console.log(`[seed]   Updated agent type "${agent.name}"`);
      agentTypeMap.set(agent.name, updated!.id);
    } else {
      const [created] = await db
        .insert(agentType)
        .values({
          key: agent.key,
          name: agent.name,
          description: agent.description,
          provisionerKey: agent.provisionerKey,
          serverOnly: agent.serverOnly,
          isEnabled: true,
        })
        .returning();
      console.log(`[seed]   Created agent type "${agent.name}"`);
      agentTypeMap.set(agent.name, created!.id);
    }
  }

  // =========================================================================
  // Seed Images
  // =========================================================================
  console.log("[seed] Seeding images...");

  // Images replaced by per-size templates. An E2B-only image would win image
  // selection on E2B (fewest providers), so existing rows are disabled, not kept.
  for (const name of RETIRED_IMAGE_NAMES) {
    const retired = await db
      .update(image)
      .set({ isEnabled: false, updatedAt: new Date() })
      .where(and(eq(image.name, name), eq(image.isEnabled, true)))
      .returning({ id: image.id });
    if (retired.length) console.log(`[seed]   Retired image "${name}"`);
  }
  const imageMap = new Map<string, string>();

  // The general server image now selects its SSH template via sshTemplateId.
  // Legacy SSH rows would otherwise win E2B image selection (fewer providers),
  // even after updating the general image's aliases. Preserve their other
  // providers and admin-managed enablement rather than retiring the whole row.
  for (const name of Object.keys(RETIRED_IMAGE_PROVIDERS)) {
    const existing = await db.query.image.findFirst({ where: eq(image.name, name) });
    if (!existing) continue;

    const providerMetadata = removeRetiredImageProviders(name, existing.providerMetadata);
    if (providerMetadata === existing.providerMetadata) continue;

    await db
      .update(image)
      .set({ providerMetadata, updatedAt: new Date() })
      .where(eq(image.id, existing.id));
    console.log(`[seed]   Removed retired provider mappings from image "${name}"`);
  }

  for (const img of seedImages) {
    const existing = await db.query.image.findFirst({
      where: eq(image.name, img.name),
    });

    const agentTypeId = agentTypeMap.get(img.agentTypeName);
    if (!agentTypeId) {
      console.log(`[seed]   Skipping image "${img.name}" - agent type not found`);
      continue;
    }

    if (existing) {
      await db
        .update(image)
        .set({
          imageId: img.imageId,
          agentTypeId,
          providerMetadata: keepPrebuilt(existing.providerMetadata, img.providerMetadata ?? {}),
          isEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(image.id, existing.id));
      console.log(`[seed]   Updated image "${img.name}"`);
      imageMap.set(img.name, existing.id);
    } else {
      const [created] = await db
        .insert(image)
        .values({
          name: img.name,
          imageId: img.imageId,
          agentTypeId,
          providerMetadata: img.providerMetadata ?? {},
          isEnabled: true,
        })
        .returning();
      console.log(`[seed]   Created image "${img.name}"`);
      imageMap.set(img.name, created!.id);
    }
  }

  // Managed E2B sandboxes (migration 0044's image row) start from E2B's base template
  // unless an admin chose another. One GitTerm used to seed goes back to base.
  const sandboxImage = await db.query.image.findFirst({
    where: eq(image.name, "gitterm-sandbox-e2b-base"),
  });
  const sandboxTemplate = sandboxImage?.providerMetadata?.e2b?.templateId;
  if (sandboxImage && SEEDED_E2B_TEMPLATE.test(sandboxTemplate ?? "")) {
    await db
      .update(image)
      .set({
        imageId: "base",
        providerMetadata: {
          ...sandboxImage.providerMetadata,
          e2b: { ...sandboxImage.providerMetadata?.e2b, templateId: "base" },
        },
        updatedAt: new Date(),
      })
      .where(eq(image.id, sandboxImage.id));
    console.log(`[seed]   Pointed managed E2B sandboxes back at E2B's base template`);
  }

  // =========================================================================
  // Seed Regions
  // =========================================================================
  console.log("[seed] Seeding regions...");

  for (const reg of seedRegions) {
    const existing = await db.query.region.findFirst({
      where: eq(region.externalRegionIdentifier, reg.externalRegionIdentifier),
    });

    if (existing) {
      console.log(`[seed]   Region "${reg.name}" already exists`);
    } else {
      const providerId = providerMap.get(reg.providerName);
      if (!providerId) {
        console.log(`[seed]   Skipping region "${reg.name}" - provider not found`);
        continue;
      }

      await db.insert(region).values({
        name: reg.name,
        location: reg.location,
        externalRegionIdentifier: reg.externalRegionIdentifier,
        cloudProviderId: providerId,
        isEnabled: true,
      });
      console.log(`[seed]   Created region "${reg.name}"`);
    }
  }

  // =========================================================================
  // Seed Model Providers
  // =========================================================================
  console.log("[seed] Seeding model providers...");

  const legacyOpenAIOAuthProvider = await db.query.modelProvider.findFirst({
    where: eq(modelProvider.name, "openai-codex"),
  });
  if (legacyOpenAIOAuthProvider) {
    await db
      .update(modelProvider)
      .set({
        name: "openai-oauth",
        displayName: "OpenAI",
        plugin: "oauth",
        logicalProviderKey: "openai",
      })
      .where(eq(modelProvider.id, legacyOpenAIOAuthProvider.id));
    console.log('[seed]   Renamed model provider "openai-codex" to "openai-oauth"');
  }

  for (const provider of MODEL_PROVIDERS) {
    const existing = await db.query.modelProvider.findFirst({
      where: eq(modelProvider.name, provider.name),
    });
    const values = {
      displayName: provider.displayName,
      logicalProviderKey: provider.logicalProviderKey,
      authType: provider.authType,
      plugin: provider.plugin,
      isRecommended: provider.isRecommended ?? false,
    };

    if (existing) {
      await db.update(modelProvider).set(values).where(eq(modelProvider.id, existing.id));
      console.log(`[seed]   Synced model provider "${provider.name}"`);
    } else {
      await db.insert(modelProvider).values({
        name: provider.name,
        ...values,
        oauthConfig: modelProviderOAuthConfig[provider.name] ?? null,
        isEnabled: true,
      });
      console.log(`[seed]   Created model provider "${provider.name}"`);
    }
  }

  // =========================================================================
  // Seed Provider Types
  // =========================================================================
  console.log("[seed] Seeding provider types...");
  const providerTypeMap = new Map<string, string>(); // name -> id

  const syncProviderConfigFields = async (providerTypeId: string, providerName: string) => {
    let createdCount = 0;
    let updatedCount = 0;

    for (const field of seedProviderTypes[providerName]!.fields) {
      const existingField = await db.query.providerConfigField.findFirst({
        where: and(
          eq(providerConfigField.providerTypeId, providerTypeId),
          eq(providerConfigField.fieldName, field.fieldName),
        ),
      });

      if (!existingField) {
        await db.insert(providerConfigField).values({
          providerTypeId,
          fieldName: field.fieldName,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          isEncrypted: field.isEncrypted,
          defaultValue: field.defaultValue,
          options: field.options ?? null,
          validationRules: field.validationRules ?? null,
          sortOrder: field.sortOrder,
        });
        createdCount += 1;
        continue;
      }

      const updates: Partial<typeof providerConfigField.$inferInsert> = {};
      const defaultValue = field.defaultValue ?? null;
      const options = field.options ?? null;
      const validationRules = field.validationRules ?? null;

      if (existingField.fieldLabel !== field.fieldLabel) {
        updates.fieldLabel = field.fieldLabel;
      }

      if (existingField.fieldType !== field.fieldType) {
        updates.fieldType = field.fieldType;
      }

      if (existingField.isRequired !== field.isRequired) {
        updates.isRequired = field.isRequired;
      }

      if (existingField.isEncrypted !== field.isEncrypted) {
        updates.isEncrypted = field.isEncrypted;
      }

      if (existingField.defaultValue !== defaultValue) {
        updates.defaultValue = defaultValue;
      }

      if (!hasSameJson(existingField.options, options)) {
        updates.options = options;
      }

      if (!hasSameJson(existingField.validationRules, validationRules)) {
        updates.validationRules = validationRules;
      }

      if (existingField.sortOrder !== field.sortOrder) {
        updates.sortOrder = field.sortOrder;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(providerConfigField)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(providerConfigField.id, existingField.id));
        updatedCount += 1;
      }
    }

    const definedFieldNames = new Set(
      seedProviderTypes[providerName]!.fields.map((field) => field.fieldName),
    );
    const allExistingFields = await db.query.providerConfigField.findMany({
      where: eq(providerConfigField.providerTypeId, providerTypeId),
    });
    let deletedCount = 0;
    for (const existing of allExistingFields) {
      if (!definedFieldNames.has(existing.fieldName)) {
        await db.delete(providerConfigField).where(eq(providerConfigField.id, existing.id));
        deletedCount += 1;
      }
    }

    if (createdCount > 0 || updatedCount > 0 || deletedCount > 0) {
      console.log(
        `[seed]   Synced config fields for "${providerName}" (created: ${createdCount}, updated: ${updatedCount}, deleted: ${deletedCount})`,
      );
    }
  };

  for (const provider of Object.values(seedProviderTypes)) {
    const existing = await db.query.providerType.findFirst({
      where: eq(providerType.name, provider.name),
    });

    if (existing) {
      const updates: Partial<typeof providerType.$inferInsert> = {};

      if (existing.displayName !== provider.displayName) {
        updates.displayName = provider.displayName;
      }

      if (existing.category !== provider.category) {
        updates.category = provider.category;
      }

      if (!hasSameJson(existing.configSchema, provider.configSchema)) {
        updates.configSchema = provider.configSchema;
      }

      if (!existing.isBuiltIn) {
        updates.isBuiltIn = true;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(providerType)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(providerType.id, existing.id));

        console.log(`[seed]   Updated provider type "${provider.name}"`);
      } else {
        console.log(`[seed]   Provider type "${provider.name}" already exists`);
      }

      providerTypeMap.set(provider.name, existing.id);

      await syncProviderConfigFields(existing.id, provider.name);
    } else {
      const [created] = await db
        .insert(providerType)
        .values({
          name: provider.name,
          displayName: provider.displayName,
          category: provider.category,
          configSchema: provider.configSchema,
          isEnabled: true,
          isBuiltIn: true,
        })
        .returning();
      console.log(`[seed]   Created provider type "${provider.name}"`);
      providerTypeMap.set(provider.name, created!.id);

      await syncProviderConfigFields(created!.id, provider.name);
    }
  }

  console.log("[seed] Database seed completed");
}
