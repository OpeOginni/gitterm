import { randomUUID } from "crypto";
import z from "zod";
import {
  accountProcedure,
  protectedProcedure,
  workspaceAgentAuthProcedure,
  router,
} from "../../index";
import { db, eq, and, asc, desc, or, ne, SQL, sql } from "@gitterm/db";
import {
  agentWorkspaceConfig,
  workspaceEnvironmentVariables,
  workspace,
  volume,
} from "@gitterm/db/schema/workspace";
import { agentType, image, cloudProvider, machineProfile, region } from "@gitterm/db/schema/cloud";
import { user } from "@gitterm/db/schema/auth";
import { workspaceSetup } from "@gitterm/db/schema/workspace-setup";
import { TRPCError } from "@trpc/server";
import {
  getOrCreateDailyUsage,
  hasRemainingQuota,
  updateLastActive,
  closeUsageSession,
  createUsageSession,
} from "../../utils/metering";
import {
  getProviderByCloudProviderId,
  isProviderImplemented,
  type PersistentWorkspaceInfo,
} from "../../providers";
import {
  BeforeAgentSetupError,
  RESERVED_WORKSPACE_ENV_KEYS,
  type ComputeProvider,
} from "../../providers/compute";
import { createProvisionLogger } from "../../providers/provision-logger";
import { WORKSPACE_EVENTS } from "../../events/workspace";
import {
  getGitHubAppService,
  isGitHubAppConfigured,
  parseGitHubRepoUrl,
  checkGitHubRepositoryWithToken,
  resolveGitHubBranchHeadWithToken,
} from "../../service/github";
import { workspaceJWT } from "../../service/auth/workspace-jwt";
import { githubAppInstallation, gitIntegration } from "@gitterm/db/schema/integrations";
import { sendWorkspaceCreatedNotification } from "../../utils/discord";
import {
  generateAndEncryptPassword,
  decryptWorkspacePassword,
  encryptWorkspacePassword,
} from "../../utils/workspace-password";
import { getWorkspaceDomain } from "../../utils/routing";
import {
  canUseCustomCloudSubdomain,
  canCreatePersistentWorkspace,
  canUseProvider,
  getDailyMinuteQuotaAsync,
  getWorkspaceLimit,
  type UserPlan,
} from "../../config/features";

function decryptServerPasswordSafe(
  encrypted: string | null | undefined,
  workspaceId: string,
): string | null {
  if (!encrypted) return null;
  try {
    return decryptWorkspacePassword(encrypted);
  } catch (error) {
    console.error(`Failed to decrypt password for workspace ${workspaceId}:`, error);
    return null;
  }
}
import {
  getProviderConfigService,
  type DecryptedProviderConfig,
} from "../../service/config/provider-config";
import { buildWorkspaceToolingManifestBase64 } from "../../utils/workspace-tooling";
import { buildWorkspaceEnv, buildWorkspaceProvisioningSpec } from "../../service/workspace-env";
import { getAgentProvisioner, resolveWorkspaceProviderCredentials } from "../../service/agents";
import type { AgentConfigByKind } from "../../service/agents/types";
import { buildAwsRuntimeInstructions } from "../../service/agents/opencode";
import { T3_PAIRING_CREATE_COMMAND } from "../../service/agents/t3code";
import {
  configKindsForAgentType,
  parseProviderMachineOptions,
  providerKeySchema,
  workspaceProviderSelectionSchema,
  workspaceSecretFilesSchema,
  workspaceSetupSchema,
  type AgentConfigKind,
  type ProviderKey,
} from "@gitterm/schema";
import {
  deleteAllWorkspaceRouteAccess,
  deleteWorkspaceRouteAccess,
  upsertWorkspaceRouteAccess,
} from "../../service/workspace-route-access";
import {
  updateWorkspaceByIdAndInvalidate,
  updateWorkspaceByIdReturningAndInvalidate,
  updateWorkspaceRoutingAndInvalidate,
  updateWorkspaceStatusAndInvalidate,
  invalidateWorkspaceCacheAfterMutation,
} from "../../service/workspace-mutations";
import {
  buildProjectPathHint,
  normalizeProvidersshAccessSupport,
  pickWorkspaceImage,
  WORKSPACE_PROFILES,
  type WorkspaceProfile,
} from "../../providers/ssh-access";
import { normalizeSshPublicKey } from "../../utils/ssh-public-key";
import { imageSupportsProvider } from "../../providers/image-compat";
import { RAILWAY_RUNTIME_PORT } from "../../providers/railway";
import { applyMachineProfile } from "../../providers/machine-profile";
import type { CloudProviderType, ImageProviderMetadata } from "@gitterm/db/schema/cloud";
import { normalizeBaseCommit } from "../../utils/workspace-base-commit";
import {
  buildWorkspaceRuntimeAccess,
  isResumableWorkspaceStatus,
  resolveProjectDirectory,
} from "../../service/workspace-runtime";
import { getWorkspaceRouteAccess } from "../../service/workspace-route-access";
import { pollHttpRuntimeHealth } from "../../utils/runtime-health";
import {
  buildGitExcludeCommand,
  buildWorkspaceSetupCommand,
  getWorkspaceSetupStatus,
  resolveWorkspaceSetupCommands,
  withWorkspaceSetupPort,
} from "../../service/workspace-setup";
import { resolveCustomWorkspaceImage } from "../../service/workspace-image";
import { finalizeWorkspaceAgentRuns } from "../../service/agent-run";
import { userCanAccessWorkspace } from "./share";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function relaunchWorkspaceSetup(
  computeProvider: ComputeProvider,
  record: typeof workspace.$inferSelect,
  providerKey: string,
) {
  if (!computeProvider.execCommand || !record.setupRequired) return;
  const setup = await db.query.workspaceSetup.findFirst({
    where: eq(workspaceSetup.workspaceId, record.id),
  });
  if (!setup || setup.status === "succeeded" || setup.status === "failed") return;
  const directory = resolveProjectDirectory(record.repositoryUrl, providerKey);
  await computeProvider
    .execCommand(record.externalInstanceId, `cd ${shellQuote(directory)} && ${setup.command}`)
    .catch((error) => console.warn("Failed to relaunch workspace setup:", error));
}

// Reserved subdomains that cannot be used by users
const RESERVED_SUBDOMAINS = [
  "api",
  "www",
  "app",
  "admin",
  "dashboard",
  "cdn",
  "static",
  "assets",
  "mail",
  "email",
  "ftp",
  "ssh",
  "docs",
  "blog",
  "status",
  "support",
];

function isSubdomainReserved(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase());
}

function normalizeRepoUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const parsed = parseGitHubRepoUrl(trimmed);

  if (parsed) {
    return `https://github.com/${parsed.owner}/${parsed.repo}`;
  }

  return trimmed.replace(/\.git\/?$/i, "");
}

/**
 * One model credential selection per provider. `apiKey` supplies an inline key
 * (never stored); `label` picks a dashboard credential by name; neither picks
 * that provider's dashboard default.
 */
const modelCredentialSelectionSchema = z
  .object({
    providerName: z.string().trim().min(1).max(100),
    apiKey: z.string().min(1).max(10_000).optional(),
    label: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (entry) => !(entry.apiKey !== undefined && entry.label !== undefined),
    "Pass either apiKey (inline) or label (dashboard credential), not both",
  );

export const repositoryCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(255).optional(),
  token: z.string().min(1).max(10_000),
});

export function resolveRepositoryProvisioningAuth(
  repositoryCredentials: { username?: string; token: string } | undefined,
  githubApp: { username?: string; token?: string },
) {
  if (repositoryCredentials) {
    return {
      authUsername: repositoryCredentials.username ?? "x-access-token",
      authToken: repositoryCredentials.token,
      inlineAuth: true,
    };
  }
  return {
    authUsername: githubApp.token ? githubApp.username : undefined,
    authToken: githubApp.token,
    inlineAuth: false,
  };
}

const MAX_WORKSPACE_METADATA_KEYS = 20;
export const workspaceMetadataSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.:-]+$/, "Metadata keys may contain letters, digits, _ . : -"),
    z.string().max(500),
  )
  .refine(
    (metadata) => Object.keys(metadata).length <= MAX_WORKSPACE_METADATA_KEYS,
    `At most ${MAX_WORKSPACE_METADATA_KEYS} metadata keys`,
  );

const workspaceCreateBaseSchema = z.object({
  name: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
  /** Caller-owned tags, returned on the workspace and filterable in listWorkspaces. */
  metadata: workspaceMetadataSchema.optional(),
  /**
   * Public image to run instead of the catalog image: an OCI reference for
   * registry-backed providers, or a public template id/alias for E2B.
   */
  image: z.string().trim().min(1).max(400).optional(),
  /** Terminate automatically this long after creation, regardless of activity. 1 minute to 30 days. */
  autoTerminateAfterMs: z
    .number()
    .int()
    .min(60_000)
    .max(30 * 24 * 60 * 60 * 1000)
    .optional(),
  repo: z.string().optional(),
  branch: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._/-]+$/)
    .optional(),
  baseCommit: z.string().trim().min(1).max(64).optional(),
  checkoutRef: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._/-]+$/)
    .optional(),
  subdomain: z
    .union([
      z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-z0-9-]+$/),
      z.literal(""),
    ])
    .optional(),
  gitIntegrationId: z.string().optional(),
  repositoryCredentials: repositoryCredentialsSchema.optional(),
  workspaceProfile: z.enum(WORKSPACE_PROFILES).default("standard").optional(),
  /** Per-provider selection: inline apiKey, dashboard credential by label, or dashboard default. */
  modelCredentials: z.array(modelCredentialSelectionSchema).max(20).optional(),
  /** Injected into this workspace only; never stored as dashboard environment settings. */
  environmentVariables: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(20_000))
    .refine((variables) => Object.keys(variables).length <= 50, "Too many environment variables")
    .refine(
      (variables) => Object.keys(variables).every((name) => !RESERVED_WORKSPACE_ENV_KEYS.has(name)),
      "Environment variables cannot override reserved workspace keys",
    )
    .optional(),
  setup: workspaceSetupSchema.optional(),
  secretFiles: workspaceSecretFilesSchema.optional(),
  additionalAgentInstructions: z.string().trim().max(50_000).optional(),
  opencode: z
    .object({
      skills: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            content: z.string().min(1).max(200_000),
          }),
        )
        .max(50)
        .optional(),
      plugins: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
      config: z
        .record(z.string(), z.unknown())
        .refine((config) => JSON.stringify(config).length <= 20_000, "OpenCode config too large")
        .optional(),
    })
    .optional(),
});

const legacyWorkspaceCreateSchema = workspaceCreateBaseSchema.extend({
  agentTypeId: z.string(),
  cloudProviderId: z.string(),
  regionId: z.string().optional(),
  machineProfileId: z.uuid().optional(),
  machineOptions: z.record(z.string(), z.unknown()).optional(),
  persistent: z.boolean(),
});

const intentWorkspaceCreateSchema = workspaceCreateBaseSchema.extend({
  repo: z.string().trim().min(1),
  agent: z.string().trim().min(1).default("opencode").optional(),
  provider: workspaceProviderSelectionSchema.optional(),
  persistent: z.boolean().optional(),
});

export const workspaceCreateSchema = z.union([
  legacyWorkspaceCreateSchema,
  intentWorkspaceCreateSchema,
]);
type ResolvedWorkspaceCreateInput = z.infer<typeof legacyWorkspaceCreateSchema>;

function matchesRegion(
  candidate: { id: string; name: string; externalRegionIdentifier: string },
  requested: string,
): boolean {
  const normalized = requested.toLowerCase();
  return (
    candidate.id === requested ||
    candidate.name.toLowerCase() === normalized ||
    candidate.externalRegionIdentifier.toLowerCase() === normalized
  );
}

async function resolveWorkspaceCreateIntent(
  rawInput: z.infer<typeof workspaceCreateSchema>,
  userId: string,
  viewerPlan: UserPlan,
): Promise<ResolvedWorkspaceCreateInput> {
  if ("agentTypeId" in rawInput) return rawInput;

  const requestedAgent = rawInput.agent ?? "opencode";
  const selectedAgent = await db.query.agentType.findFirst({
    where: and(eq(agentType.key, requestedAgent), eq(agentType.isEnabled, true)),
  });
  if (!selectedAgent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No enabled agent matches "${requestedAgent}"`,
    });
  }

  const providerSelection = rawInput.provider;
  const providerRows = await db.query.cloudProvider.findMany({
    where: eq(cloudProvider.isEnabled, true),
    with: {
      regions: { where: eq(region.isEnabled, true), orderBy: [asc(region.name)] },
      machineProfiles: {
        where: eq(machineProfile.isEnabled, true),
        orderBy: [desc(machineProfile.isDefault), asc(machineProfile.name)],
      },
    },
    orderBy: [desc(cloudProvider.preferredDefault), asc(cloudProvider.name)],
  });
  const eligibleProviders = providerRows.filter(
    (candidate) =>
      canUseProvider(viewerPlan, candidate.providerKey.toLowerCase()) &&
      (candidate.providerKey.toLowerCase() === "local" ||
        isProviderImplemented(candidate.providerKey)),
  );

  let candidates = eligibleProviders;
  if (providerSelection) {
    candidates = candidates.filter(
      (candidate) =>
        candidate.providerKey === providerSelection.type &&
        (!providerSelection.providerId || candidate.id === providerSelection.providerId),
    );
    if ("region" in providerSelection && providerSelection.region) {
      const requestedRegion = providerSelection.region;
      const regionMatches = candidates.filter((candidate) =>
        candidate.regions.some((candidateRegion) =>
          matchesRegion(candidateRegion, requestedRegion),
        ),
      );
      if (regionMatches.length > 0) candidates = regionMatches;
    }
  } else {
    const currentUser = await db.query.user.findFirst({ where: eq(user.id, userId) });
    const savedDefault = eligibleProviders.find(
      (candidate) => candidate.id === currentUser?.defaultCloudProviderId,
    );
    const preferredDefault = eligibleProviders.find((candidate) => candidate.preferredDefault);
    candidates = savedDefault
      ? [savedDefault]
      : preferredDefault
        ? [preferredDefault]
        : eligibleProviders;
  }

  const selectedProvider = candidates[0];
  if (!selectedProvider) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No enabled provider matches this request" });
  }

  const requestedRegion =
    providerSelection && "region" in providerSelection ? providerSelection.region : undefined;
  const selectedRegion = requestedRegion
    ? selectedProvider.regions.find((candidate) => matchesRegion(candidate, requestedRegion))
    : selectedProvider.regions[0];
  if (requestedRegion && !selectedRegion) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No enabled region matches this request" });
  }

  const requestedMachine = providerSelection?.machine;
  if (
    requestedMachine?.type === "custom" &&
    selectedProvider.machineSelectionPolicy.mode !== "flexible"
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This provider does not allow custom machine sizes",
    });
  }
  if (
    requestedMachine?.type === "profile" &&
    selectedProvider.machineSelectionPolicy.mode === "standard"
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This provider uses its standard machine size",
    });
  }
  const selectedMachine =
    requestedMachine?.type === "profile"
      ? selectedProvider.machineProfiles.find(
          (candidate) =>
            candidate.key === requestedMachine.key || candidate.id === requestedMachine.key,
        )
      : selectedProvider.machineProfiles[0];
  if (requestedMachine?.type === "profile" && !selectedMachine) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No enabled machine profile matches "${requestedMachine}"`,
    });
  }

  const { agent: _agent, provider: _provider, ...workspaceInput } = rawInput;
  return {
    ...workspaceInput,
    agentTypeId: selectedAgent.id,
    cloudProviderId: selectedProvider.id,
    regionId: selectedRegion?.id,
    machineProfileId: selectedMachine?.id,
    machineOptions:
      requestedMachine?.type === "custom"
        ? parseProviderMachineOptions(
            selectedProvider.providerKey as ProviderKey,
            requestedMachine.resources,
          )
        : undefined,
    persistent: rawInput.persistent ?? selectedProvider.autoPersistent,
  };
}

async function getConfiguredDefaultRegionIdentifier(
  provider: CloudProviderType,
): Promise<string | undefined> {
  if (!provider.providerConfigId) {
    return undefined;
  }

  const providerConfig = await getProviderConfigService().getProviderConfigById(
    provider.providerConfigId,
  );
  if (!providerConfig?.isEnabled) {
    return undefined;
  }

  const defaultRegionIdentifier =
    providerConfig.config.defaultTargetRegion?.trim() ??
    providerConfig.config.defaultRegion?.trim();

  return defaultRegionIdentifier || undefined;
}

export const workspaceRouter = router({
  listUserInstallations: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    const installations = await db
      .select()
      .from(gitIntegration)
      .innerJoin(
        githubAppInstallation,
        eq(gitIntegration.providerInstallationId, githubAppInstallation.installationId),
      )
      .where(eq(gitIntegration.userId, userId));

    return {
      success: true,
      installations,
    };
  }),

  /**
   * Get the current user's subdomain permissions.
   * Used by the frontend to conditionally show subdomain input fields.
   */
  getSubdomainPermissions: protectedProcedure.query(async ({ ctx }) => {
    const userPlan = ctx.session.user.plan;

    if (!userPlan) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    return {
      canUseCustomCloudSubdomain: canUseCustomCloudSubdomain(userPlan as UserPlan),
      userPlan,
    };
  }),

  // List all agent types
  listAgentTypes: accountProcedure("workspace:read")
    .input(
      z
        .object({
          serverOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      let whereClause: SQL<unknown> | undefined = eq(agentType.isEnabled, true);

      if (input?.serverOnly) {
        whereClause = and(whereClause, eq(agentType.serverOnly, true));
      }

      try {
        const types = await db.select().from(agentType).where(whereClause);
        return {
          success: true,
          agentTypes: types,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch agent types",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List images for a specific agent type
  listImages: protectedProcedure
    .input(z.object({ agentTypeId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const images = await db
          .select()
          .from(image)
          .where(and(eq(image.agentTypeId, input.agentTypeId), eq(image.isEnabled, true)));
        return {
          success: true,
          images,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch images",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List cloud providers
  listCloudProviders: accountProcedure("workspace:read")
    .input(
      z
        .object({
          localOnly: z.boolean().optional(),
          cloudOnly: z.boolean().optional(),
          sandboxOnly: z.boolean().optional(),
          nonSandboxOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      let whereClause: SQL<unknown> | undefined = eq(cloudProvider.isEnabled, true);

      if (input?.localOnly) {
        whereClause = and(whereClause, eq(cloudProvider.name, "Local"));
      }

      if (input?.cloudOnly) {
        whereClause = and(whereClause, ne(cloudProvider.name, "Local"));
      }

      if (input?.sandboxOnly) {
        whereClause = and(whereClause, eq(cloudProvider.isSandbox, true));
      }

      if (input?.nonSandboxOnly) {
        whereClause = and(whereClause, eq(cloudProvider.isSandbox, false));
      }

      try {
        const providers = await db.query.cloudProvider.findMany({
          where: whereClause,
          with: {
            regions: {
              where: eq(region.isEnabled, true),
              orderBy: [asc(region.name)],
            },
            machineProfiles: {
              where: eq(machineProfile.isEnabled, true),
              orderBy: [desc(machineProfile.isDefault), asc(machineProfile.name)],
            },
          },
          orderBy: [desc(cloudProvider.preferredDefault), asc(cloudProvider.name)],
        });

        // Plan-based provider gating: free tier only sees E2B (and Local).
        // Paid plans and self-hosted see everything. Done in-memory so the
        // gating rules live in one place (config/features).
        const viewerPlan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
        const planVisibleProviders = providers.filter((provider) => {
          const providerKey = (provider.providerKey ?? "local").toLowerCase();
          return (
            (providerKey === "local" || isProviderImplemented(providerKey)) &&
            (providerKey === "local" || canUseProvider(viewerPlan, providerKey))
          );
        });

        const providersWithEditorSupport = await Promise.all(
          planVisibleProviders.map(async (provider) => {
            let regions = provider.regions;

            if (provider.providerKey === "aws") {
              // AWS providers are region-scoped (one cloud_provider row per region).
              // The pinned region is the region row attached to this provider.
              // We oldest-first sort to make this deterministic across legacy data
              // where multiple region rows may be attached.
              const sorted = [...regions].toSorted(
                (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
              );
              regions = sorted.slice(0, 1);
            } else if (
              provider.supportsRegions &&
              !provider.allowUserRegionSelection &&
              regions.length > 0
            ) {
              const configuredDefaultRegionIdentifier =
                await getConfiguredDefaultRegionIdentifier(provider);

              const lockedRegion = configuredDefaultRegionIdentifier
                ? regions.find(
                    (providerRegion) =>
                      providerRegion.externalRegionIdentifier === configuredDefaultRegionIdentifier,
                  )
                : regions[0];

              regions = lockedRegion ? [lockedRegion] : regions.slice(0, 1);
            }

            return {
              ...provider,
              regions,
              machineProfiles: provider.machineProfiles.map((profile) => ({
                id: profile.id,
                key: profile.key,
                name: profile.name,
                description: profile.description,
                isDefault: profile.isDefault,
              })),
              sshAccessSupport: normalizeProvidersshAccessSupport(provider.sshAccessSupport),
            };
          }),
        );

        return {
          success: true,
          cloudProviders: providersWithEditorSupport,
        };
      } catch (error) {
        console.error("Failed to fetch cloud providers", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch cloud providers",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getWorkspaceCatalog: accountProcedure("workspace:read").query(async ({ ctx }) => {
    const viewerPlan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
    const [currentUser, agents, providers, images] = await Promise.all([
      db.query.user.findFirst({ where: eq(user.id, ctx.session.user.id) }),
      db.query.agentType.findMany({
        where: eq(agentType.isEnabled, true),
        orderBy: [asc(agentType.name)],
      }),
      db.query.cloudProvider.findMany({
        where: eq(cloudProvider.isEnabled, true),
        with: {
          regions: { where: eq(region.isEnabled, true), orderBy: [asc(region.name)] },
          machineProfiles: {
            where: eq(machineProfile.isEnabled, true),
            orderBy: [desc(machineProfile.isDefault), asc(machineProfile.name)],
          },
        },
        orderBy: [desc(cloudProvider.preferredDefault), asc(cloudProvider.name)],
      }),
      db.query.image.findMany({ where: eq(image.isEnabled, true) }),
    ]);

    // Daytona Tier 1/2 orgs block workspace -> API egress, so in-workspace
    // features (scoped CLI, credential refresh) are unavailable there.
    const daytonaWorkspaceApiAccess = providers.some(
      (provider) => provider.providerKey?.toLowerCase() === "daytona",
    )
      ? (
          (await getProviderConfigService().getProviderConfigForUse("daytona")) as {
            tier3NetworkAccess?: boolean;
          } | null
        )?.tier3NetworkAccess === true
      : true;

    const catalogProviders = providers.flatMap((provider) => {
      const parsedKey = providerKeySchema.safeParse(provider.providerKey);
      if (
        !parsedKey.success ||
        !isProviderImplemented(parsedKey.data) ||
        !canUseProvider(viewerPlan, parsedKey.data)
      )
        return [];

      const agentKeys = agents
        .filter((agent) =>
          images.some(
            (candidateImage) =>
              candidateImage.agentTypeId === agent.id &&
              imageSupportsProvider(
                parsedKey.data,
                candidateImage.providerMetadata as ImageProviderMetadata,
              ),
          ),
        )
        .map((agent) => agent.key);

      if (agentKeys.length === 0) return [];

      return [
        {
          id: provider.id,
          type: parsedKey.data,
          name: provider.name,
          isDefault:
            provider.id === currentUser?.defaultCloudProviderId ||
            (!currentUser?.defaultCloudProviderId && provider.preferredDefault),
          persistence: provider.supportsPersistence
            ? provider.autoPersistent
              ? ("required" as const)
              : ("optional" as const)
            : ("unsupported" as const),
          regionSelection: !provider.supportsRegions
            ? ("none" as const)
            : provider.allowUserRegionSelection
              ? ("user" as const)
              : ("admin" as const),
          regions: provider.regions.map((providerRegion) => ({
            id: providerRegion.id,
            key: providerRegion.externalRegionIdentifier,
            name: providerRegion.name,
            location: providerRegion.location,
          })),
          machines: provider.machineProfiles.map((profile) => ({
            id: profile.id,
            key: profile.key,
            name: profile.name,
            description: profile.description,
            isDefault: profile.isDefault,
          })),
          agentKeys,
          ssh: normalizeProvidersshAccessSupport(provider.sshAccessSupport).supported,
          workspaceApiAccess: parsedKey.data === "daytona" ? daytonaWorkspaceApiAccess : true,
        },
      ];
    });

    return {
      agents: agents.map((agent) => ({
        id: agent.id,
        key: agent.key,
        name: agent.name,
        description: agent.description,
        serverOnly: agent.serverOnly,
      })),
      providers: catalogProviders,
    };
  }),

  // List all workspaces for the authenticated user (paginated)
  listWorkspaces: accountProcedure("workspace:read")
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(12),
          offset: z.number().min(0).default(0),
          status: z.enum(["all", "active", "terminated"]).default("active"),
          /** Only workspaces whose metadata contains every given key/value. */
          metadata: workspaceMetadataSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { limit = 12, offset = 0, status = "active", metadata } = input ?? {};

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        // Build where clause based on status filter
        const statusOnlyCondition =
          status === "all"
            ? eq(workspace.userId, userId)
            : status === "terminated"
              ? and(eq(workspace.userId, userId), eq(workspace.status, "terminated"))
              : and(
                  eq(workspace.userId, userId),
                  or(
                    eq(workspace.status, "running"),
                    eq(workspace.status, "pending"),
                    eq(workspace.status, "paused"),
                  ),
                );
        const statusCondition =
          metadata && Object.keys(metadata).length > 0
            ? and(
                statusOnlyCondition,
                sql`${workspace.metadata} @> ${JSON.stringify(metadata)}::jsonb`,
              )
            : statusOnlyCondition;

        // Get total count using efficient COUNT query
        const [countResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(workspace)
          .where(statusCondition);

        const total = Number(countResult?.count ?? 0);

        // Fetch paginated workspaces
        const workspaces = await db.query.workspace.findMany({
          where: statusCondition,
          with: {
            image: {
              with: {
                agentType: true,
              },
            },
          },
          orderBy: (workspace, { desc }) =>
            status === "terminated"
              ? [desc(workspace.terminatedAt), desc(workspace.startedAt)]
              : [desc(workspace.startedAt)],
          limit,
          offset,
        });

        return {
          success: true,
          workspaces: workspaces.map((record) => ({
            ...record,
            serverPassword: null,
            hasAccessCredential: Boolean(record.serverPassword),
          })),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + workspaces.length < total,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workspaces",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getWorkspace: accountProcedure("workspace:read")
    .input(z.object({ workspaceId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const workspaceRecord = await db.query.workspace.findFirst({
          where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
          with: {
            image: {
              with: {
                agentType: true,
              },
            },
          },
        });

        if (!workspaceRecord) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        return {
          success: true,
          workspace: {
            ...workspaceRecord,
            serverPassword: null,
            hasAccessCredential: Boolean(workspaceRecord.serverPassword),
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  getAccessCredential: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const workspaceRecord = await db.query.workspace.findFirst({
        where: eq(workspace.id, input.workspaceId),
        columns: { id: true, serverPassword: true },
      });
      if (
        !workspaceRecord ||
        !(await userCanAccessWorkspace(workspaceRecord.id, ctx.session.user.id))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }
      ctx.honoContext.header("Cache-Control", "no-store, private");
      return {
        credential: decryptServerPasswordSafe(workspaceRecord.serverPassword, workspaceRecord.id),
      };
    }),

  /**
   * Mint a fresh agent access credential (e.g. a T3 pairing token — they are
   * one-time, so pairing a second device needs a new one). Only supported for
   * agents that issue their own credentials, on providers that can exec.
   */
  regenerateAccessCredential: protectedProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const workspaceRecord = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
        with: {
          image: {
            with: {
              agentType: true,
            },
          },
        },
      });

      if (!workspaceRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }

      if (workspaceRecord.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Workspace must be running to generate a new pairing link",
        });
      }

      const agentTypeName = workspaceRecord.image?.agentType?.name ?? "";
      if (!agentTypeName.trim().toLowerCase().startsWith("t3code")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This agent does not issue pairing credentials",
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, workspaceRecord.cloudProviderId));

      if (!provider) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cloud provider not found" });
      }

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);

      if (!computeProvider.execCommand) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This provider cannot generate new pairing links; restart the workspace instead",
        });
      }

      const result = await computeProvider.execCommand(
        workspaceRecord.externalInstanceId,
        T3_PAIRING_CREATE_COMMAND,
      );

      const credential = result.stdout.trim();
      if (result.exitCode !== 0 || !credential) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate a new pairing token",
        });
      }

      await updateWorkspaceByIdAndInvalidate(input.workspaceId, {
        serverPassword: encryptWorkspacePassword(credential),
      });

      return { success: true, credential };
    }),

  getWorkspaceSSHAccess: protectedProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const [workspaceRecord] = await db
        .select()
        .from(workspace)
        .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)))
        .limit(1);

      if (!workspaceRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (!workspaceRecord.editorAccessEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Editor access is not enabled for this workspace.",
        });
      }

      if (workspaceRecord.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start the workspace before generating editor SSH access.",
        });
      }

      const [providerRecord] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, workspaceRecord.cloudProviderId))
        .limit(1);

      if (!providerRecord) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Workspace provider not found",
        });
      }

      let regionIdentifier: string | undefined;

      if (workspaceRecord.regionId) {
        const [workspaceRegion] = await db
          .select()
          .from(region)
          .where(eq(region.id, workspaceRecord.regionId))
          .limit(1);
        regionIdentifier = workspaceRegion?.externalRegionIdentifier;
      }

      try {
        const computeProvider = await getProviderByCloudProviderId(providerRecord.providerKey);
        const access = await computeProvider.getWorkspaceSSHAccess({
          workspaceId: workspaceRecord.id,
          userId,
          externalServiceId: workspaceRecord.externalInstanceId,
          subdomain: workspaceRecord.subdomain ?? workspaceRecord.id,
          projectPathHint: buildProjectPathHint(workspaceRecord.repositoryUrl),
          regionIdentifier,
          existingConnection: workspaceRecord.sshConnection ?? undefined,
        });

        if (access.connection) {
          await db
            .update(workspace)
            .set({
              sshConnection: access.connection,
              updatedAt: new Date(),
            })
            .where(eq(workspace.id, workspaceRecord.id));
        }

        return {
          success: true,
          access,
          workspaceProfile: workspaceRecord.workspaceProfile,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to generate editor access details",
        });
      }
    }),

  // Create or update environment variables for a workspace
  createEnvironmentVariables: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
        environmentVariables: z
          .record(z.string(), z.string())
          .refine((obj) => Object.keys(obj).length > 0, {
            message: "Environment variables cannot be empty",
          }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        // Check if environment variables already exist
        const existingVars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (existingVars.length > 0) {
          // Update existing environment variables
          const [updatedVars] = await db
            .update(workspaceEnvironmentVariables)
            .set({
              environmentVariables: input.environmentVariables,
              updatedAt: new Date(),
            })
            .where(eq(workspaceEnvironmentVariables.id, existingVars[0]!.id))
            .returning();

          return {
            success: true,
            message: "Environment variables updated successfully",
            environmentVariables: updatedVars,
          };
        } else {
          // Create new environment variables
          const [newVars] = await db
            .insert(workspaceEnvironmentVariables)
            .values({
              userId,
              agentTypeId: input.agentTypeId,
              environmentVariables: input.environmentVariables,
            })
            .returning();

          return {
            success: true,
            message: "Environment variables created successfully",
            environmentVariables: newVars,
          };
        }
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create or update environment variables",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Get environment variables for a specific agent type
  getEnvironmentVariables: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
      }),
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const vars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found for this agent type",
          });
        }

        return {
          success: true,
          environmentVariables: vars[0]!,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch environment variables",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // List all environment variables for the authenticated user
  listEnvironmentVariables: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const vars = await db
        .select()
        .from(workspaceEnvironmentVariables)
        .where(eq(workspaceEnvironmentVariables.userId, userId));

      return {
        success: true,
        environmentVariables: vars,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch environment variables",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Delete environment variables
  deleteEnvironmentVariables: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const vars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found",
          });
        }

        await db
          .delete(workspaceEnvironmentVariables)
          .where(eq(workspaceEnvironmentVariables.id, vars[0]!.id));

        return {
          success: true,
          message: "Environment variables deleted successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete environment variables",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Update a specific environment variable
  updateEnvironmentVariable: protectedProcedure
    .input(
      z.object({
        agentTypeId: z.string().min(1, "Agent type ID is required"),
        key: z.string().min(1, "Key is required"),
        value: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      try {
        const vars = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        if (vars.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Environment variables not found for this agent type",
          });
        }

        const updatedEnvVars = {
          ...(vars[0]!.environmentVariables as Record<string, string>),
          [input.key]: input.value,
        };

        const [updated] = await db
          .update(workspaceEnvironmentVariables)
          .set({
            environmentVariables: updatedEnvVars,
            updatedAt: new Date(),
          })
          .where(eq(workspaceEnvironmentVariables.id, vars[0]!.id))
          .returning();

        return {
          success: true,
          message: "Environment variable updated successfully",
          environmentVariables: updated,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update environment variable",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // ============================================================================
  // Metering & Quota Endpoints
  // ============================================================================

  // Get daily usage for the authenticated user
  getDailyUsage: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const plan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
      const usage = await getOrCreateDailyUsage(userId, plan);
      const dailyQuota = await getDailyMinuteQuotaAsync(plan);
      return {
        success: true,
        minutesUsed: usage.minutesUsed,
        minutesRemaining: usage.minutesRemaining,
        dailyLimit: Number.isFinite(dailyQuota) ? dailyQuota : null,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch daily usage",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Check if user can start a new workspace (has remaining quota)
  checkQuota: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not authenticated",
      });
    }

    try {
      const plan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
      const canStart = await hasRemainingQuota(userId, plan);
      const usage = await getOrCreateDailyUsage(userId, plan);
      const dailyQuota = await getDailyMinuteQuotaAsync(plan);

      return {
        success: true,
        canStartWorkspace: canStart,
        minutesRemaining: usage.minutesRemaining,
        dailyLimit: Number.isFinite(dailyQuota) ? dailyQuota : null,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to check quota",
        cause: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }),

  // Heartbeat endpoint for workspace agents (uses JWT auth)
  heartbeat: workspaceAgentAuthProcedure
    .input(
      z.object({
        workspaceId: z.uuid(),
        timestamp: z.number().optional(),
        cpu: z.number().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { workspaceAuth } = ctx;

      if (!workspaceJWT.hasScope(workspaceAuth, "agent:heartbeat")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient agent scope" });
      }

      // Verify workspace ID matches token
      if (workspaceAuth.workspaceId !== input.workspaceId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Token workspace mismatch",
        });
      }

      try {
        // Verify workspace exists
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(eq(workspace.id, input.workspaceId));

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        // Verify ownership
        if (existingWorkspace.userId !== workspaceAuth.userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Workspace ownership mismatch",
          });
        }

        if (existingWorkspace.status !== "running" && existingWorkspace.status !== "pending") {
          return {
            success: true,
            action: "shutdown" as const,
            reason: "workspace_inactive",
          };
        }

        // Check if workspace is still allowed to run (quota check)
        const hasQuota = await hasRemainingQuota(existingWorkspace.userId);

        if (!hasQuota) {
          // User exceeded quota - signal shutdown
          return {
            success: true,
            action: "shutdown" as const,
            reason: "quota_exhausted",
          };
        }

        // Update last active timestamp
        await updateLastActive(input.workspaceId);

        return {
          success: true,
          action: "continue" as const,
          reason: null,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process heartbeat",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Create a new workspace. ID-based input remains supported for the web app;
  // integrations can submit stable provider and agent intent instead.
  createWorkspace: accountProcedure("workspace:write")
    .input(workspaceCreateSchema)
    .mutation(async ({ input: rawInput, ctx }) => {
      const userId = ctx.session.user.id;
      const workspaceId = randomUUID();
      const inlineRepositoryToken = rawInput.repositoryCredentials?.token;
      const workspaceCreateLogger = createProvisionLogger(
        "workspace-router",
        workspaceId,
        inlineRepositoryToken ? [inlineRepositoryToken] : [],
      );

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const viewerPlan = ((ctx.session.user as { plan?: UserPlan }).plan ?? "free") as UserPlan;
      const input = await resolveWorkspaceCreateIntent(rawInput, userId, viewerPlan);

      if (input.repositoryCredentials && !input.repo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "repositoryCredentials require repo",
        });
      }

      let resolvedBaseCommit: string | null = null;
      try {
        resolvedBaseCommit = normalizeBaseCommit(input.baseCommit);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid baseCommit",
        });
      }
      const resolvedCheckoutRef = input.checkoutRef?.trim() || null;

      const [fetchedUser] = await db.select().from(user).where(eq(user.id, userId));

      if (!fetchedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      if (input.idempotencyKey) {
        const existing = await db.query.workspace.findFirst({
          where: and(
            eq(workspace.userId, userId),
            eq(workspace.idempotencyKey, input.idempotencyKey),
          ),
        });
        if (existing) {
          const [existingProvider] = await db
            .select()
            .from(cloudProvider)
            .where(eq(cloudProvider.id, existing.cloudProviderId));
          const headers = await getWorkspaceRouteAccess(existing.id, null);
          let password: string | null = null;
          if (existing.serverPassword) {
            password = decryptWorkspacePassword(existing.serverPassword);
          }
          return {
            success: true,
            message: "Existing workspace returned for idempotency key",
            workspace: existing,
            volume: null,
            runtime: buildWorkspaceRuntimeAccess({
              workspace: existing,
              headers,
              password,
              providerKey: existingProvider?.providerKey ?? null,
              providerCanResume: existingProvider?.providerKey !== "cloudflare",
            }),
          };
        }
      }

      // Validate that the provided repo is publicly clonable using `git ls-remote`
      if (input.repo) {
        input.repo = normalizeRepoUrl(input.repo);

        // Only support HTTPS URLs for now; `.git` suffix is added later if missing
        if (!/^https:\/\/.+$/i.test(input.repo)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Repository URL must be a valid HTTPS Git URL",
          });
        }
      }

      let selectedProviderName = "unknown provider";
      let selectedProviderKey = "unknown";
      try {
        // Get cloud provider info first to determine if local
        const [cloudProviderRecord] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, input.cloudProviderId));

        if (!cloudProviderRecord) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid cloud provider",
          });
        }

        if (!cloudProviderRecord.isEnabled) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected cloud provider is not available",
          });
        }

        selectedProviderName = cloudProviderRecord.name;
        selectedProviderKey = cloudProviderRecord.providerKey;

        const providerConfigService = getProviderConfigService();
        let selectedProviderConfig: DecryptedProviderConfig | null = null;

        const providerKey = (cloudProviderRecord.providerKey ?? "local").toLowerCase();
        if (providerKey !== "local" && !isProviderImplemented(providerKey)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected cloud provider is no longer supported",
          });
        }
        const selectedMachineProfile = input.machineProfileId
          ? await db.query.machineProfile.findFirst({
              where: and(
                eq(machineProfile.id, input.machineProfileId),
                eq(machineProfile.cloudProviderId, cloudProviderRecord.id),
                eq(machineProfile.isEnabled, true),
              ),
            })
          : await db.query.machineProfile.findFirst({
              where: and(
                eq(machineProfile.cloudProviderId, cloudProviderRecord.id),
                eq(machineProfile.isEnabled, true),
              ),
              orderBy: [desc(machineProfile.isDefault), asc(machineProfile.name)],
            });

        if (input.machineProfileId && !selectedMachineProfile) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected machine profile is not available for this provider",
          });
        }

        if (providerKey !== "local") {
          if (!cloudProviderRecord.providerConfigId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Selected cloud provider is missing configuration",
            });
          }

          selectedProviderConfig = await providerConfigService.getProviderConfigById(
            cloudProviderRecord.providerConfigId,
          );

          if (!selectedProviderConfig || !selectedProviderConfig.isEnabled) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Selected cloud provider is not configured",
            });
          }
        }

        // Determine if this is a local workspace
        const isLocal = providerKey === "local";

        // Plan-based provider gating. Free tier may only use E2B; all paid
        // plans (and self-hosted) may use any enabled provider. Local
        // workspaces don't consume our managed compute, so they're exempt.
        const planForGating = (fetchedUser.plan || "free") as UserPlan;
        if (!isLocal && !canUseProvider(planForGating, providerKey)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "The Free plan can only use E2B sandboxes. Upgrade to Starter or Pro to use this provider.",
          });
        }

        const workspaceProfile = (input.workspaceProfile ?? "standard") as WorkspaceProfile;
        const editorAccessEnabled = workspaceProfile === "ssh-enabled";
        const providerEditorSupport = normalizeProvidersshAccessSupport(
          cloudProviderRecord.sshAccessSupport,
        );

        if (editorAccessEnabled) {
          const requiresUserSshKey = providerKey !== "daytona";
          if (requiresUserSshKey && !fetchedUser.sshPublicKey) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Add an SSH public key in Settings before enabling editor access for this provider.",
            });
          }

          if (!providerEditorSupport.supported) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${cloudProviderRecord.name} does not currently support editor SSH access.`,
            });
          }
        }

        // Check quota only for cloud workspaces (local doesn't use our resources)
        if (!isLocal) {
          const hasQuota = await hasRemainingQuota(userId, planForGating);
          if (!hasQuota) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                planForGating === "pro"
                  ? "Daily cloud runtime limit reached. It resets at midnight UTC."
                  : "Daily cloud runtime limit reached. It resets at midnight UTC, or upgrade for more runtime.",
            });
          }
        }

        const runningWorkspaces = await db
          .select()
          .from(workspace)
          .where(
            and(
              eq(workspace.userId, userId),
              or(
                eq(workspace.status, "running"),
                eq(workspace.status, "pending"),
                eq(workspace.status, "paused"),
              ),
            ),
          );

        // Check workspace limit based on plan
        const userPlanForLimit = (fetchedUser.plan || "free") as UserPlan;
        const workspaceLimit = getWorkspaceLimit(userPlanForLimit);

        if (runningWorkspaces.length >= workspaceLimit) {
          const upgradeHint =
            userPlanForLimit === "free"
              ? ` Upgrade to Starter (5) or Pro (15) for more.`
              : userPlanForLimit === "starter"
                ? ` Upgrade to Pro for up to 15.`
                : "";
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              `You've reached your plan limit of ${workspaceLimit} workspaces.` +
              (upgradeHint || " Delete some workspaces to create new ones."),
          });
        }

        // For cloud workspaces, repo is required
        if (!isLocal && !input.repo) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Repository URL is required for cloud workspaces",
          });
        }

        // Get region info
        let regionRecord: typeof region.$inferSelect | undefined;

        if (cloudProviderRecord.supportsRegions) {
          if (providerKey === "aws") {
            // AWS providers are region-scoped: each cloud_provider row represents
            // exactly one AWS region, set when the provider was created via
            // `aws.createRegionProvider`. The pinned region is the region row
            // attached to this specific cloud_provider - NOT anything stored on
            // the shared providerConfig blob (which only holds credentials).
            //
            // Reading region from providerConfig.defaultRegion would silently
            // route deploys to the wrong region when:
            //   - the provider hasn't been bootstrapped yet (providerConfigId null)
            //   - the providerConfig points to a stale/shared default config
            // Always resolve via the attached region row.
            [regionRecord] = await db
              .select()
              .from(region)
              .where(
                and(eq(region.cloudProviderId, input.cloudProviderId), eq(region.isEnabled, true)),
              )
              .orderBy(asc(region.createdAt))
              .limit(1);

            if (!regionRecord) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "This AWS provider has no enabled region attached. Re-create the provider with a valid region.",
              });
            }
          } else if (cloudProviderRecord.allowUserRegionSelection) {
            // User can select - validate the provided region
            if (input.regionId) {
              [regionRecord] = await db
                .select()
                .from(region)
                .where(
                  and(
                    eq(region.id, input.regionId),
                    eq(region.cloudProviderId, input.cloudProviderId),
                  ),
                );

              if (!regionRecord) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Invalid region for the selected cloud provider",
                });
              }

              if (!regionRecord.isEnabled) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Selected region is not available",
                });
              }
            } else {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Region is required for the selected cloud provider",
              });
            }
          } else {
            // User cannot select - use the default region from provider config
            const defaultRegionIdentifier =
              await getConfiguredDefaultRegionIdentifier(cloudProviderRecord);

            if (defaultRegionIdentifier) {
              [regionRecord] = await db
                .select()
                .from(region)
                .where(
                  and(
                    eq(region.externalRegionIdentifier, defaultRegionIdentifier),
                    eq(region.cloudProviderId, input.cloudProviderId),
                    eq(region.isEnabled, true),
                  ),
                );
            }

            // If no default region found or not enabled, fall back to any enabled
            // region attached to this provider.
            if (!regionRecord) {
              const [anyEnabledRegion] = await db
                .select()
                .from(region)
                .where(
                  and(
                    eq(region.cloudProviderId, input.cloudProviderId),
                    eq(region.isEnabled, true),
                  ),
                )
                .orderBy(asc(region.name))
                .limit(1);

              regionRecord = anyEnabledRegion;
            }

            if (!regionRecord) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "No available region found for the selected cloud provider",
              });
            }
          }
        }

        // Get image for this agent type (take the first one)
        const imageRecords = await db
          .select()
          .from(image)
          .where(and(eq(image.agentTypeId, input.agentTypeId), eq(image.isEnabled, true)))
          .orderBy(desc(image.updatedAt));

        const [agentTypeRecord] = await db
          .select()
          .from(agentType)
          .where(eq(agentType.id, input.agentTypeId));

        if (!agentTypeRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No agent type found for this agent type",
          });
        }

        if (!agentTypeRecord.isEnabled) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected agent type is not available",
          });
        }

        // Local workspaces can only use serverOnly agent types
        if (isLocal && !agentTypeRecord.serverOnly) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Local workspaces can only use server-only agent types",
          });
        }

        if (editorAccessEnabled && !agentTypeRecord.serverOnly) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Editor access currently requires a server-only agent type.",
          });
        }

        const compatibleImageRecords = imageRecords.filter((img) =>
          imageSupportsProvider(providerKey, img.providerMetadata as ImageProviderMetadata | null),
        );
        const imageRecord = pickWorkspaceImage(compatibleImageRecords, workspaceProfile);

        if (!imageRecord) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "No enabled image found for this agent type",
          });
        }

        const applicableKinds = configKindsForAgentType(agentTypeRecord.name);
        const agentConfigs: AgentConfigByKind = {};
        if (applicableKinds.length > 0) {
          const rows = await db
            .select()
            .from(agentWorkspaceConfig)
            .where(eq(agentWorkspaceConfig.userId, userId))
            .orderBy(desc(agentWorkspaceConfig.updatedAt));

          for (const kind of applicableKinds) {
            const row = rows.find((r) => r.kind === kind);
            if (row) {
              agentConfigs[kind as AgentConfigKind] = row.config as Record<string, unknown>;
            }
          }
        }

        // Fetch user's workspace environment variables
        const [userWorkspaceEnvironmentVariables] = await db
          .select()
          .from(workspaceEnvironmentVariables)
          .where(
            and(
              eq(workspaceEnvironmentVariables.userId, userId),
              eq(workspaceEnvironmentVariables.agentTypeId, input.agentTypeId),
            ),
          );

        // Get GitHub username from user.name (set during OAuth)
        const [userRecord] = await db.select().from(user).where(eq(user.id, userId));

        const githubUsername = userRecord?.name ?? undefined;

        // Validate git integration / repo access first, then generate token if needed
        let githubAppToken: string | undefined;
        let githubAppTokenExpiry: string | undefined;
        let githubInstallationId: string | undefined;
        let selectedGitIntegration: typeof gitIntegration.$inferSelect | undefined;

        if (input.gitIntegrationId && !input.repositoryCredentials) {
          if (!isGitHubAppConfigured()) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "GitHub App is not configured for this deployment",
            });
          }
          const [gitIntegrationRecord] = await db
            .select()
            .from(gitIntegration)
            .where(
              and(eq(gitIntegration.id, input.gitIntegrationId), eq(gitIntegration.userId, userId)),
            );

          if (!gitIntegrationRecord) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Git integration not found",
            });
          }

          if (gitIntegrationRecord.provider !== "github") {
            // TODO: Support other git providers
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid git provider",
            });
          }
          selectedGitIntegration = gitIntegrationRecord;
        }

        if (input.repo) {
          if (!input.repositoryCredentials && !isGitHubAppConfigured()) {
            const parsed = parseGitHubRepoUrl(input.repo);
            if (!parsed) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid repository URL",
              });
            }
          } else {
            const [userExistingGithubAppInstallation] = await db
              .select()
              .from(githubAppInstallation)
              .where(eq(githubAppInstallation.userId, userId))
              .limit(1);

            const options = selectedGitIntegration
              ? { userId: userId, gitIntegrationId: selectedGitIntegration.id }
              : undefined;

            const repoValidation = input.repositoryCredentials
              ? await checkGitHubRepositoryWithToken(
                  input.repo,
                  input.repositoryCredentials.token,
                  input.branch,
                  resolvedBaseCommit ?? undefined,
                )
              : await getGitHubAppService().checkIfValidRepository(
                  input.repo,
                  options,
                  input.branch,
                  resolvedBaseCommit ?? undefined,
                );

            if (!repoValidation.valid)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid repository URL",
              });

            if (!repoValidation.exists) {
              if (input.repositoryCredentials) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Can't access repository with the supplied repository credentials",
                });
              }
              if (!selectedGitIntegration && userExistingGithubAppInstallation) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "Can't access repository. Configure Repository Access to use private repos (connect one in Integrations if needed).",
                });
              }

              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Can't access repository, check URL or github integration",
              });
            }

            if (!repoValidation.canClone)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: input.repositoryCredentials
                  ? "Can't clone repository with the supplied repository credentials"
                  : "Can't clone repository, check github integration",
              });

            if (input.branch && !repoValidation.branchExists)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Branch "${input.branch}" not found in this repository`,
              });

            if (resolvedBaseCommit && !repoValidation.commitExists)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commit "${resolvedBaseCommit}" not found in this repository`,
              });
          }
        }

        if (selectedGitIntegration) {
          const installation = await getGitHubAppService().getUserInstallation(
            userId,
            selectedGitIntegration.providerInstallationId,
          );

          if (installation && !installation.suspended) {
            const repoName = parseGitHubRepoUrl(input.repo || "")?.repo;

            githubInstallationId = installation.installationId;
            try {
              const tokenData = await getGitHubAppService().getUserToServerToken(
                installation.installationId,
                repoName ? [repoName] : undefined,
              );
              githubAppToken = tokenData.token;
              githubAppTokenExpiry = tokenData.expiresAt;
            } catch (error) {
              console.error("Failed to generate GitHub App token:", error);
              // Continue without token - user can still use workspace without git operations
            }
          }
        }

        // Parse repo URL to get owner/name (only for cloud workspaces)
        const repoInfo = input.repo ? parseGitHubRepoUrl(input.repo) : null;

        // Resolve exact base commit when not provided by the caller.
        if (input.repo && !resolvedBaseCommit) {
          try {
            const headSha = input.repositoryCredentials
              ? await resolveGitHubBranchHeadWithToken(
                  input.repo,
                  input.repositoryCredentials.token,
                  input.branch,
                )
              : await getGitHubAppService().resolveBranchHeadSha(
                  input.repo,
                  input.branch,
                  selectedGitIntegration
                    ? {
                        userId,
                        gitIntegrationId: selectedGitIntegration.id,
                        installationId: githubInstallationId,
                      }
                    : undefined,
                );
            if (headSha) {
              resolvedBaseCommit = normalizeBaseCommit(headSha);
            }
          } catch (error) {
            console.warn("Failed to resolve baseCommit from branch head:", error);
          }
        }

        // Generate or validate subdomain
        let subdomain: string;
        const userPlan = (fetchedUser.plan || "free") as UserPlan;

        if (input.subdomain) {
          // User wants a custom subdomain

          // Check if subdomain is reserved
          if (isSubdomainReserved(input.subdomain)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Subdomain '${input.subdomain}' is reserved and cannot be used`,
            });
          }

          if (!canUseCustomCloudSubdomain(userPlan)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Custom cloud subdomains require a Pro plan.",
            });
          }

          // Check uniqueness - only among running/pending workspaces
          const [existing] = await db
            .select()
            .from(workspace)
            .where(
              and(
                eq(workspace.subdomain, input.subdomain),
                or(eq(workspace.status, "running"), eq(workspace.status, "pending")),
              ),
            )
            .limit(1);

          if (existing) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Subdomain already taken",
            });
          }

          subdomain = input.subdomain;
        } else {
          // No custom subdomain provided - generate one automatically
          // Format: {first2sections} e.g., abc12345-def67890
          let attempts = 0;
          do {
            if (attempts > 10) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to generate unique subdomain",
              });
            }
            const uuid = randomUUID();
            const uuidParts = uuid.split("-");
            subdomain = `${uuidParts[0]}`;
            attempts++;

            // Check if generated subdomain is reserved (unlikely but possible)
            if (isSubdomainReserved(subdomain)) {
              continue;
            }
          } while (
            await db
              .select()
              .from(workspace)
              .where(eq(workspace.subdomain, subdomain))
              .limit(1)
              .then((rows) => rows.length > 0)
          );
        }

        // Generate workspace-scoped JWT token (replaces shared INTERNAL_API_KEY)
        const workspaceAuthToken = workspaceJWT.generateToken(
          workspaceId,
          userId,
          ["workspace:read", "port:*"],
          "workspace",
        );
        const workspaceAgentAuthToken = workspaceJWT.generateToken(
          workspaceId,
          userId,
          ["agent:credential", "agent:heartbeat"],
          "agent",
        );
        const workspaceSetupAuthToken = workspaceJWT.generateToken(
          workspaceId,
          userId,
          ["setup:write"],
          "setup",
        );

        // API endpoint for workspace operations
        const WORKSPACE_API_URL =
          process.env.WORKSPACE_API_URL ||
          process.env.INTERNAL_API_URL ||
          "https://api.gitterm.dev/trpc";

        // Generate domain using routing utils
        // In path mode: returns just subdomain (stored for lookup)
        // In subdomain mode: returns subdomain.baseDomain
        const domain = getWorkspaceDomain(subdomain);

        const WORKSPACE_TOOLING_MANIFEST_BASE64 = await workspaceCreateLogger.step(
          "build-tooling-manifest",
          () =>
            buildWorkspaceToolingManifestBase64({
              owner: repoInfo?.owner,
              repo: repoInfo?.repo,
              installationId: githubInstallationId,
            }),
        );

        // Generate server password for serverOnly workspaces
        let serverPassword: string | undefined;
        let encryptedServerPassword: string | undefined;

        if (agentTypeRecord.serverOnly) {
          const passwordData = generateAndEncryptPassword();
          serverPassword = passwordData.password;
          encryptedServerPassword = passwordData.encryptedPassword;
        }

        const credentials = await workspaceCreateLogger.step("fetch-model-credentials", () =>
          resolveWorkspaceProviderCredentials({
            userId,
            modelCredentials: input.modelCredentials,
          }),
        );
        const awsRuntimeInstructions =
          providerKey === "aws" && regionRecord
            ? buildAwsRuntimeInstructions({
                region: regionRecord.externalRegionIdentifier,
                location: regionRecord.location,
                taskRoleArn:
                  typeof selectedProviderConfig?.config.taskRoleArn === "string"
                    ? selectedProviderConfig.config.taskRoleArn
                    : undefined,
              })
            : undefined;
        const additionalAgentInstructions = [
          awsRuntimeInstructions,
          input.additionalAgentInstructions?.trim(),
        ]
          .filter((instructions): instructions is string => Boolean(instructions))
          .join("\n\n");
        const agentProvisioning = getAgentProvisioner(agentTypeRecord.provisionerKey).provision({
          userId,
          userDisplayName: fetchedUser.name,
          workspaceHostname: `${subdomain}.${process.env.BASE_DOMAIN ?? "gitterm.dev"}`,
          agentTypeName: agentTypeRecord.name,
          serverOnly: agentTypeRecord.serverOnly,
          agentConfigs,
          serverPassword,
          credentials,
          additionalAgentInstructions: additionalAgentInstructions || undefined,
          opencode: input.opencode,
        });
        agentProvisioning.files.push(
          ...(input.secretFiles ?? []).map((file) => ({
            path: file.path,
            contentBase64: Buffer.from(file.content).toString("base64"),
            mode: Number.parseInt(file.mode ?? "0600", 8) as 0o400 | 0o600,
            relativeToRepo: true,
          })),
        );

        // Secret files live under the repository; exclude them from git before the
        // agent can `git add -A` them. Runs as the first blocking before-agent step.
        const secretFileExcludeCommand = buildGitExcludeCommand(
          (input.secretFiles ?? []).map((file) => file.path),
        );
        const beforeAgentCommands = [
          ...(secretFileExcludeCommand ? [secretFileExcludeCommand] : []),
          ...(await resolveWorkspaceSetupCommands({
            cloudProviderId: input.cloudProviderId,
            agentTypeId: input.agentTypeId,
            requestedCommands: input.setup?.beforeAgent,
          })),
        ];
        const afterAgentCommands = input.setup?.afterAgent ?? [];
        const setupRequested = beforeAgentCommands.length > 0 || afterAgentCommands.length > 0;
        const setupExecutionId = setupRequested ? randomUUID() : undefined;
        // The setup script's readiness probe must target the port the runtime
        // actually listens on. SDK providers launch serve.command themselves,
        // so serve.port is correct; Railway and AWS run the image entrypoint,
        // which serves on the image's fixed port instead.
        const setupProbePort = ["railway", "aws"].includes(providerKey)
          ? RAILWAY_RUNTIME_PORT
          : agentProvisioning.serve?.port;
        // Tier 1/2 Daytona sandboxes cannot reach the API: skip push reports
        // (their retry backoff would delay setup ~30s per report) and rely on
        // the server-side polling reconciler instead.
        const workspaceCanPushSetupStatus =
          providerKey !== "daytona" ||
          (
            (await getProviderConfigService().getProviderConfigForUse("daytona")) as {
              tier3NetworkAccess?: boolean;
            } | null
          )?.tier3NetworkAccess === true;
        const beforeAgentCommand = buildWorkspaceSetupCommand(beforeAgentCommands, setupProbePort, {
          phase: "before-agent",
          waitForAgent: false,
          detached: false,
          failOnError: true,
          disablePush: true,
        });
        const setupCommand = buildWorkspaceSetupCommand(afterAgentCommands, setupProbePort, {
          executionId: setupExecutionId,
          disablePush: !workspaceCanPushSetupStatus,
          phase: "after-agent",
        });
        const runtimeSetupCommand =
          setupCommand && setupProbePort !== undefined
            ? withWorkspaceSetupPort(setupCommand, setupProbePort)
            : setupCommand;

        if (runtimeSetupCommand && agentProvisioning.serve) {
          agentProvisioning.serve.postStartCommand = [
            agentProvisioning.serve.postStartCommand,
            runtimeSetupCommand,
          ]
            .filter(Boolean)
            .join("\n");
        }

        if (!agentProvisioning.usesServerPassword) {
          encryptedServerPassword = undefined;
        }

        const provisioningSpec = buildWorkspaceProvisioningSpec({
          agent: agentProvisioning,
          repo: input.repo
            ? {
                url: input.repo,
                branch: input.branch?.trim() || undefined,
                baseCommit: resolvedBaseCommit ?? undefined,
                checkoutRef: resolvedCheckoutRef ?? undefined,
                name: repoInfo?.repo,
                ...resolveRepositoryProvisioningAuth(input.repositoryCredentials, {
                  username: githubUsername,
                  token: githubAppToken,
                }),
              }
            : null,
          serverPassword,
          sshPublicKey:
            editorAccessEnabled && providerKey !== "daytona"
              ? normalizeSshPublicKey(fetchedUser.sshPublicKey ?? "")
              : undefined,
          workspaceProfile,
          editorAccessEnabled,
          setupCommand: runtimeSetupCommand,
          beforeAgentCommand,
        });

        // Serialize the spec + runtime vars into the env handed to the compute
        // provider. User-defined vars are merged here, with reserved system keys
        // stripped so they cannot clobber WORKSPACE_AUTH_TOKEN and friends.
        const workspaceUserEnv = userWorkspaceEnvironmentVariables
          ? {
              ...(userWorkspaceEnvironmentVariables.environmentVariables as Record<
                string,
                string | undefined
              >),
              ...input.environmentVariables,
            }
          : input.environmentVariables;
        const DEFAULT_DOCKER_ENV_VARS = buildWorkspaceEnv(provisioningSpec, {
          githubUsername,
          githubAppToken,
          githubAppTokenExpiry,
          toolingManifestBase64: WORKSPACE_TOOLING_MANIFEST_BASE64,
          repoOwner: repoInfo?.owner,
          workspaceId,
          workspaceAuthToken,
          workspaceAgentAuthToken,
          workspaceSetupAuthToken,
          workspaceApiUrl: WORKSPACE_API_URL,
          workspaceProvider: providerKey,
          userEnv: workspaceUserEnv,
        });
        if (providerKey === "aws" && regionRecord) {
          DEFAULT_DOCKER_ENV_VARS.AWS_REGION = regionRecord.externalRegionIdentifier;
          DEFAULT_DOCKER_ENV_VARS.AWS_DEFAULT_REGION = regionRecord.externalRegionIdentifier;
        }

        // Get compute provider
        const computeProvider = await getProviderByCloudProviderId(providerKey);
        let imageProviderMetadata = applyMachineProfile(
          imageRecord.providerMetadata,
          providerKey,
          input.machineOptions ?? selectedMachineProfile?.providerOptions,
        );

        // Bring-your-own image: swap what the provider runs, keep the catalog
        // record for agent type and provider sizing metadata.
        let providerImageId = imageRecord.imageId;
        let customImage: string | null = null;
        if (input.image) {
          const resolvedImage = await workspaceCreateLogger.step("resolve-custom-image", () =>
            resolveCustomWorkspaceImage(input.image!, providerKey),
          );
          if (resolvedImage.kind === "registry") {
            providerImageId = resolvedImage.reference;
            customImage = resolvedImage.reference;
          } else {
            imageProviderMetadata = {
              ...imageProviderMetadata,
              e2b: { templateId: resolvedImage.templateId },
            };
            customImage = resolvedImage.templateId;
          }
        }

        // Plan-based persistence gating: free tier cannot opt into persistent
        // (volume-backed) workspaces. Guard server-side even though the UI hides
        // the toggle. Self-hosted and paid plans are allowed.
        //
        // Exception: when the provider is auto-persistent (e.g. E2B), persistence
        // is inherent to the provider and cannot be disabled, so we allow it for
        // every plan. We only block opt-in persistence on providers that don't
        // force it on; otherwise free users couldn't use auto-persistent
        // providers at all.
        if (
          input.persistent &&
          !cloudProviderRecord.autoPersistent &&
          !canCreatePersistentWorkspace(planForGating)
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Persistent workspaces require a Starter or Pro plan. Upgrade to keep your workspace state.",
          });
        }

        // Force ephemeral when the provider can't persist files (e.g. Cloudflare
        // sandboxes). The UI disables the toggle, but guard server-side too.
        const effectivePersistent =
          cloudProviderRecord.supportsPersistence === false ? false : input.persistent;

        // If immediate we send the intial workspace status to running
        const initialWorkspaceStatus =
          cloudProviderRecord.creationSettlement === "immediate" ? "running" : "pending";

        // Create workspace via compute provider
        const workspaceInfo = await workspaceCreateLogger.step(
          `provision-workspace provider=${providerKey} persistent=${effectivePersistent}`,
          () =>
            effectivePersistent
              ? computeProvider.createPersistentWorkspace({
                  workspaceId,
                  userId,
                  imageId: providerImageId,
                  imageProviderMetadata,
                  subdomain,
                  repositoryUrl: input.repo,
                  repositoryBranch: input.branch,
                  repositoryBaseCommit: resolvedBaseCommit ?? undefined,
                  repositoryCheckoutRef: resolvedCheckoutRef ?? undefined,
                  regionIdentifier: regionRecord?.externalRegionIdentifier,
                  environmentVariables: DEFAULT_DOCKER_ENV_VARS,
                  provisioningSpec,
                  persistent: effectivePersistent,
                })
              : computeProvider.createWorkspace({
                  workspaceId,
                  userId,
                  imageId: providerImageId,
                  imageProviderMetadata,
                  subdomain,
                  repositoryUrl: input.repo,
                  repositoryBranch: input.branch,
                  repositoryBaseCommit: resolvedBaseCommit ?? undefined,
                  repositoryCheckoutRef: resolvedCheckoutRef ?? undefined,
                  regionIdentifier: regionRecord?.externalRegionIdentifier,
                  environmentVariables: DEFAULT_DOCKER_ENV_VARS,
                  provisioningSpec,
                }),
        );

        // SDK providers may have captured the agent's own access credential
        // (e.g. a T3 pairing token); it takes the server password's place.
        if (workspaceInfo.accessCredential) {
          encryptedServerPassword = encryptWorkspacePassword(workspaceInfo.accessCredential);
        }

        // Save workspace to database
        const [newWorkspace] = await db
          .insert(workspace)
          .values({
            id: workspaceId,
            externalInstanceId: workspaceInfo.externalServiceId,
            userId,
            imageId: imageRecord.id,
            cloudProviderId: input.cloudProviderId,
            machineProfileId: selectedMachineProfile?.id ?? null,
            launchProfileId: null,
            gitIntegrationId: input.gitIntegrationId ?? null,
            // Persist resolved defaults too, so later runs validate the exact injected credentials.
            modelCredentialIds: credentials
              .map((credential) => credential.credentialId)
              .filter((id): id is string => id !== null),
            inlineModelProviders: credentials
              .filter((credential) => credential.credentialId === null)
              .map((credential) => credential.logicalProviderKey),
            setupRequired: setupRequested,
            persistent: effectivePersistent,
            regionId: regionRecord?.id,
            repositoryUrl: input.repo ?? null,
            repositoryBranch: input.branch ?? null,
            repositoryBaseCommit: resolvedBaseCommit,
            repositoryCheckoutRef: resolvedCheckoutRef,
            domain,
            subdomain,
            serverOnly: agentTypeRecord.serverOnly,
            workspaceProfile,
            editorAccessEnabled,
            editorTarget: null,
            sshConnection: null,
            serverPassword: encryptedServerPassword ?? null,
            upstreamUrl: workspaceInfo.upstreamUrl,
            status: initialWorkspaceStatus,
            hostingType: isLocal ? "local" : "cloud",
            name: input.name || subdomain,
            metadata: input.metadata ?? {},
            customImage,
            autoTerminateAt: input.autoTerminateAfterMs
              ? new Date(Date.now() + input.autoTerminateAfterMs)
              : null,
            idempotencyKey: input.idempotencyKey ?? null,
            startedAt: new Date(workspaceInfo.serviceCreatedAt),
            lastActiveAt: new Date(workspaceInfo.serviceCreatedAt),
            updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          })
          .returning();

        if (!newWorkspace) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create workspace record",
          });
        }

        if (setupRequested && setupExecutionId) {
          await db.insert(workspaceSetup).values({
            workspaceId,
            executionId: setupExecutionId,
            command: runtimeSetupCommand ?? "",
            status: runtimeSetupCommand ? "waiting" : "succeeded",
            // Only a blocking phase was requested and it already ran during provisioning.
            ...(runtimeSetupCommand
              ? {}
              : { exitCode: 0, startedAt: new Date(), finishedAt: new Date() }),
          });
        }

        workspaceCreateLogger.log(
          `workspace-record-created provider=${providerKey} persistent=${effectivePersistent}`,
        );

        if (workspaceInfo.upstreamAccess?.headers) {
          await upsertWorkspaceRouteAccess(workspaceId, null, workspaceInfo.upstreamAccess.headers);
        }
        await invalidateWorkspaceCacheAfterMutation(workspaceId, subdomain);

        // Create volume record (only for persistent workspaces)
        let newVolume = null;
        if (effectivePersistent) {
          const persistentInfo = workspaceInfo as PersistentWorkspaceInfo;
          const [volumeRecord] = await db
            .insert(volume)
            .values({
              workspaceId: workspaceId,
              userId: userId,
              cloudProviderId: input.cloudProviderId,
              regionId: regionRecord?.id,
              externalVolumeId: persistentInfo.externalVolumeId,
              mountPath: "/workspace",
              createdAt: new Date(persistentInfo.volumeCreatedAt),
              updatedAt: new Date(persistentInfo.volumeCreatedAt),
            })
            .returning();
          newVolume = volumeRecord;
        }

        // Create usage session for billing (only for remote workspaces)
        if (!isLocal) {
          await createUsageSession(workspaceId, userId);
        }

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId,
          status: initialWorkspaceStatus,
          updatedAt: new Date(workspaceInfo.serviceCreatedAt),
          userId,
          workspaceDomain: domain,
        });

        sendWorkspaceCreatedNotification({
          domain,
          subdomain,
          workspaceId,
          status: newWorkspace.status,
          hostingType: newWorkspace.hostingType,
          persistent: newWorkspace.persistent,
          serverOnly: newWorkspace.serverOnly,
          userName: fetchedUser.name,
          userEmail: fetchedUser.email,
          agentTypeName: agentTypeRecord.name,
          cloudProviderName: cloudProviderRecord.name,
          regionName: regionRecord?.name || "no-region",
          regionExternalIdentifier: regionRecord?.externalRegionIdentifier || "N/A",
          repoUrl: input.repo,
          serviceCreatedAt: workspaceInfo.serviceCreatedAt,
          upstreamUrl: newWorkspace.upstreamUrl,
        });

        const workspaceForRuntime = {
          ...newWorkspace,
          serverPassword: serverPassword ?? newWorkspace.serverPassword,
        };
        const runtime = buildWorkspaceRuntimeAccess({
          workspace: workspaceForRuntime,
          headers: workspaceInfo.upstreamAccess?.headers ?? null,
          password: serverPassword ?? null,
          providerKey,
        });

        return {
          success: true,
          message: "Workspace created successfully",
          workspace: newWorkspace,
          volume: newVolume,
          runtime,
        };
      } catch (error) {
        console.error("createWorkspace failed", {
          workspaceId,
          providerKey: selectedProviderKey,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        // Throw a user-friendly error to the client
        if (error instanceof TRPCError) throw error;
        if (error instanceof BeforeAgentSetupError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create workspace using ${selectedProviderName} (${selectedProviderKey}); reference: ${workspaceId}`,
        });
      }
    }),

  getSetupStatus: accountProcedure("workspace:read")
    .input(z.object({ workspaceId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const workspaceRecord = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, ctx.session.user.id)),
        with: { image: { with: { agentType: true } } },
      });
      if (!workspaceRecord) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
      }
      if (!workspaceRecord.setupRequired) {
        return getWorkspaceSetupStatus(workspaceRecord.id, false);
      }
      return getWorkspaceSetupStatus(workspaceRecord.id);
    }),

  getRuntimeAccess: accountProcedure("workspace:access")
    .input(z.object({ workspaceId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      let workspaceRecord = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
      });

      if (!workspaceRecord) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, workspaceRecord.cloudProviderId));
      if (
        provider &&
        workspaceRecord.externalInstanceId &&
        (workspaceRecord.status === "paused" || workspaceRecord.status === "pending")
      ) {
        try {
          const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
          const live = await computeProvider.getStatus(workspaceRecord.externalInstanceId);
          if (live.status === "running") {
            const now = new Date();
            // Guard on the stale status so a concurrent lifecycle transition
            // (terminate, ensureRunning claim) is never overwritten.
            const [reconciled] = await updateWorkspaceStatusAndInvalidate(
              and(
                eq(workspace.id, workspaceRecord.id),
                or(eq(workspace.status, "paused"), eq(workspace.status, "pending")),
              ),
              { status: "running", pausedAt: null, lastActiveAt: now, updatedAt: now },
            );
            if (reconciled) {
              WORKSPACE_EVENTS.emitStatus({
                workspaceId: reconciled.id,
                status: reconciled.status,
                updatedAt: reconciled.updatedAt,
                userId,
                workspaceDomain: reconciled.workspaceDomain,
              });
              workspaceRecord =
                (await db.query.workspace.findFirst({
                  where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
                })) ?? workspaceRecord;
            }
          }
        } catch (error) {
          console.error(
            `Failed to reconcile live provider status for workspace ${workspaceRecord.id}:`,
            error,
          );
        }
      }

      let password: string | null = null;
      if (workspaceRecord.serverPassword) {
        try {
          password = decryptWorkspacePassword(workspaceRecord.serverPassword);
        } catch (error) {
          console.error(`Failed to decrypt password for workspace ${workspaceRecord.id}:`, error);
        }
      }

      const headers = await getWorkspaceRouteAccess(workspaceRecord.id, null);

      return buildWorkspaceRuntimeAccess({
        workspace: workspaceRecord,
        headers,
        password,
        providerKey: provider?.providerKey ?? null,
        providerCanResume:
          workspaceRecord.status === "paused" && provider?.providerKey !== "cloudflare",
      });
    }),

  ensureRunning: accountProcedure("workspace:write")
    .input(
      z.object({
        workspaceId: z.uuid(),
        /** Max time to wait for runtime URL after restart (ms). */
        timeoutMs: z.number().int().min(1_000).max(240_000).default(120_000).optional(),
        /** Poll interval while waiting for running status (ms). */
        pollIntervalMs: z.number().int().min(250).max(10_000).default(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const timeoutMs = input.timeoutMs ?? 120_000;
      const pollIntervalMs = input.pollIntervalMs ?? 2_000;

      const loadOwnedWorkspace = async () => {
        const [row] = await db
          .select()
          .from(workspace)
          .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));
        return row ?? null;
      };

      let existingWorkspace = await loadOwnedWorkspace();
      if (!existingWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (existingWorkspace.status === "terminated") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "WORKSPACE_TERMINATED: workspace cannot be restarted",
        });
      }

      const [runtimeProvider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));
      const statusProvider =
        runtimeProvider && existingWorkspace.externalInstanceId
          ? await getProviderByCloudProviderId(runtimeProvider.providerKey)
          : null;

      const reconcileProviderStatus = async () => {
        const workspaceRecord = existingWorkspace;
        if (!statusProvider || !workspaceRecord?.externalInstanceId) return;

        const live = await statusProvider.getStatus(workspaceRecord.externalInstanceId);
        const shouldUpdate =
          (workspaceRecord.status === "pending" || workspaceRecord.status === "running") &&
          live.status !== workspaceRecord.status;
        if (!shouldUpdate) return;

        const now = new Date();
        const [reconciled] = await updateWorkspaceStatusAndInvalidate(
          and(eq(workspace.id, workspaceRecord.id), eq(workspace.status, workspaceRecord.status)),
          {
            status: live.status,
            updatedAt: now,
            ...(live.status === "paused" ? { pausedAt: now } : {}),
            ...(live.status === "terminated" ? { terminatedAt: now } : {}),
          },
        );
        if (!reconciled) return;

        WORKSPACE_EVENTS.emitStatus({
          workspaceId: reconciled.id,
          status: reconciled.status,
          updatedAt: reconciled.updatedAt,
          userId,
          workspaceDomain: reconciled.workspaceDomain,
        });
        existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
      };

      if (isResumableWorkspaceStatus(existingWorkspace.status)) {
        // Atomically claim the restart. Concurrent callers observe pending and
        // wait for the same provider operation instead of starting another one.
        const [claimedWorkspace] = await db
          .update(workspace)
          .set({ status: "pending", updatedAt: new Date() })
          .where(
            and(
              eq(workspace.id, input.workspaceId),
              eq(workspace.userId, userId),
              eq(workspace.status, "paused"),
            ),
          )
          .returning();

        if (!claimedWorkspace) {
          existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
        } else {
          existingWorkspace = claimedWorkspace;
          const hasQuota = await hasRemainingQuota(userId);
          if (!hasQuota) {
            await updateWorkspaceByIdAndInvalidate(
              input.workspaceId,
              { status: "paused", updatedAt: new Date() },
              existingWorkspace.subdomain,
            );
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Daily free tier limit reached. Please try again tomorrow.",
            });
          }

          const [provider] = await db
            .select()
            .from(cloudProvider)
            .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

          if (!provider) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Cloud provider not found",
            });
          }

          if (provider.providerKey === "cloudflare") {
            await updateWorkspaceByIdAndInvalidate(
              input.workspaceId,
              { status: "paused", updatedAt: new Date() },
              existingWorkspace.subdomain,
            );
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "WORKSPACE_NON_RECOVERABLE: provider does not preserve paused filesystem state",
            });
          }

          let workspaceRegion;
          if (provider.supportsRegions && existingWorkspace.regionId) {
            [workspaceRegion] = await db
              .select()
              .from(region)
              .where(eq(region.id, existingWorkspace.regionId));
          }

          const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
          let resumeResult: void | { upstreamUrl?: string };
          try {
            resumeResult = await computeProvider.resumeWorkspace(
              existingWorkspace.externalInstanceId,
              workspaceRegion?.externalRegionIdentifier,
              existingWorkspace.externalRunningDeploymentId ?? undefined,
            );
            await relaunchWorkspaceSetup(computeProvider, existingWorkspace, provider.providerKey);
          } catch (error) {
            await updateWorkspaceByIdAndInvalidate(
              input.workspaceId,
              { status: "paused", updatedAt: new Date() },
              existingWorkspace.subdomain,
            );
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "WORKSPACE_RESTART_FAILED: provider could not restart the workspace",
              cause: error,
            });
          }

          const restartWorkspaceStatus =
            provider.restartSettlement === "immediate" ? "running" : "pending";
          const now = new Date();
          await updateWorkspaceByIdAndInvalidate(
            input.workspaceId,
            {
              status: restartWorkspaceStatus,
              pausedAt: null,
              lastActiveAt: now,
              updatedAt: now,
              ...(resumeResult?.upstreamUrl ? { upstreamUrl: resumeResult.upstreamUrl } : {}),
            },
            existingWorkspace.subdomain,
          );

          await createUsageSession(input.workspaceId, userId);

          WORKSPACE_EVENTS.emitStatus({
            workspaceId: input.workspaceId,
            status: restartWorkspaceStatus,
            updatedAt: now,
            userId,
            workspaceDomain: existingWorkspace.domain,
          });

          existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
        }
      }

      // Keep the entire wait below Bun's 255-second maximum idle timeout.
      const deadline = Date.now() + timeoutMs;

      // Wait until running (or timeout) when still pending after restart/create.
      if (existingWorkspace.status === "pending" || existingWorkspace.status === "running") {
        while (Date.now() < deadline) {
          existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
          await reconcileProviderStatus();
          if (existingWorkspace.status === "running" && existingWorkspace.subdomain) {
            break;
          }
          if (existingWorkspace.status === "terminated") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "WORKSPACE_TERMINATED: workspace terminated during startup",
            });
          }
          if (existingWorkspace.status === "running") break;
          if (existingWorkspace.status !== "pending") break;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }

      existingWorkspace = (await loadOwnedWorkspace()) ?? existingWorkspace;
      if (!existingWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      if (existingWorkspace.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `WORKSPACE_START_TIMEOUT: workspace remained ${existingWorkspace.status}`,
        });
      }

      let password: string | null = null;
      if (existingWorkspace.serverPassword) {
        try {
          password = decryptWorkspacePassword(existingWorkspace.serverPassword);
        } catch (error) {
          console.error(`Failed to decrypt password for workspace ${existingWorkspace.id}:`, error);
        }
      }

      const headers = await getWorkspaceRouteAccess(existingWorkspace.id, null);
      const runtime = buildWorkspaceRuntimeAccess({
        workspace: existingWorkspace,
        headers,
        password,
        providerKey: runtimeProvider?.providerKey ?? null,
        providerCanResume: runtimeProvider?.providerKey !== "cloudflare",
      });

      if (!runtime.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "WORKSPACE_START_TIMEOUT: runtime URL is not available",
        });
      }
      const healthy = await pollHttpRuntimeHealth({
        url: runtime.url,
        headers: runtime.headers,
        timeoutMs: Math.max(0, deadline - Date.now()),
        intervalMs: pollIntervalMs,
        // Authentication failures still prove that the runtime server is up.
        isHealthy: (response) => response.status < 500,
        onUnhealthy: async () => {
          await reconcileProviderStatus();
          const status = existingWorkspace?.status;
          if (status === "paused" || status === "terminated") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `WORKSPACE_START_FAILED: provider reported ${status}`,
            });
          }
        },
      });
      if (!healthy) {
        throw new TRPCError({
          code: "TIMEOUT",
          message: "WORKSPACE_START_TIMEOUT: runtime health check did not pass",
        });
      }

      return {
        success: true,
        workspace: existingWorkspace,
        runtime,
      };
    }),

  // Pause a running workspace (compute down, recoverable)
  pauseWorkspace: accountProcedure("workspace:write")
    .input(
      z.object({
        workspaceId: z.uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Verify workspace belongs to user
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        if (existingWorkspace.status !== "running") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Workspace is not running",
          });
        }

        // Get the cloud provider name
        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

        if (!provider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        let workspaceRegion;
        if (provider.supportsRegions && existingWorkspace.regionId) {
          // Get the region identifier
          [workspaceRegion] = await db
            .select()
            .from(region)
            .where(eq(region.id, existingWorkspace.regionId));

          if (!workspaceRegion) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Region not found",
            });
          }
        }

        // Get compute provider and stop the workspace
        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        await finalizeWorkspaceAgentRuns(input.workspaceId, userId);
        if (existingWorkspace.sshConnection) {
          await computeProvider
            .revokeWorkspaceSSHAccess({
              workspaceId: existingWorkspace.id,
              externalServiceId: existingWorkspace.externalInstanceId,
              connection: existingWorkspace.sshConnection,
              regionIdentifier: workspaceRegion?.externalRegionIdentifier,
            })
            .catch((error) => {
              console.warn("Failed to revoke workspace editor access during stop:", error);
            });
        }

        await computeProvider.pauseWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion?.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined,
        );

        // Close the usage session
        const { durationMinutes } = await closeUsageSession(input.workspaceId, "manual");

        // Update workspace status
        const now = new Date();
        await updateWorkspaceByIdAndInvalidate(
          input.workspaceId,
          {
            status: "paused",
            pausedAt: now,
            sshConnection: null,
            updatedAt: now,
          },
          existingWorkspace.subdomain,
        );

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId: input.workspaceId,
          status: "paused",
          updatedAt: now,
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        return {
          success: true,
          message: "Workspace paused successfully",
          durationMinutes,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to pause workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Restart a paused workspace
  restartWorkspace: accountProcedure("workspace:write")
    .input(
      z.object({
        workspaceId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      try {
        // Check quota first
        const hasQuota = await hasRemainingQuota(userId);
        if (!hasQuota) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Daily free tier limit reached. Please try again tomorrow.",
          });
        }

        // Verify workspace belongs to user
        const [existingWorkspace] = await db
          .select()
          .from(workspace)
          .where(and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)));

        if (!existingWorkspace) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workspace not found",
          });
        }

        if (existingWorkspace.status !== "paused") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Workspace is not paused",
          });
        }

        // Get the cloud provider name
        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, existingWorkspace.cloudProviderId));

        if (!provider) {
          console.error("Cloud provider not found for workspace:", existingWorkspace.id);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        let workspaceRegion;
        if (provider.supportsRegions && existingWorkspace.regionId) {
          // Get the region identifier
          [workspaceRegion] = await db
            .select()
            .from(region)
            .where(eq(region.id, existingWorkspace.regionId));

          if (!workspaceRegion) {
            console.error("Region not found for workspace:", existingWorkspace.id);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Region not found",
            });
          }
        }

        // Get compute provider and restart the workspace
        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        const resumeResult = await computeProvider.resumeWorkspace(
          existingWorkspace.externalInstanceId,
          workspaceRegion?.externalRegionIdentifier,
          existingWorkspace.externalRunningDeploymentId ?? undefined,
        );
        await relaunchWorkspaceSetup(computeProvider, existingWorkspace, provider.providerKey);

        const restartWorkspaceStatus =
          provider.restartSettlement === "immediate" ? "running" : "pending";
        // Update workspace status
        const now = new Date();
        await updateWorkspaceByIdAndInvalidate(
          input.workspaceId,
          {
            status: restartWorkspaceStatus,
            pausedAt: null,
            lastActiveAt: now,
            updatedAt: now,
            ...(resumeResult?.upstreamUrl ? { upstreamUrl: resumeResult.upstreamUrl } : {}),
          },
          existingWorkspace.subdomain,
        );

        await createUsageSession(input.workspaceId, userId);

        // Emit status event
        WORKSPACE_EVENTS.emitStatus({
          workspaceId: input.workspaceId,
          status: restartWorkspaceStatus,
          updatedAt: now,
          userId,
          workspaceDomain: existingWorkspace.domain,
        });

        return {
          success: true,
          message:
            restartWorkspaceStatus === "running"
              ? "Workspace restarted successfully"
              : "Workspace restarting",
          status: restartWorkspaceStatus,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("Failed to restart workspace:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to restart workspace",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),

  // Delete a workspace
  deleteWorkspace: accountProcedure("workspace:write")
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const fetchedWorkspace = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
        with: {
          volume: true,
        },
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      // Close usage session if workspace was running
      if (fetchedWorkspace.status === "running" || fetchedWorkspace.status === "pending") {
        await closeUsageSession(input.workspaceId, "manual");
      }

      // Get the cloud provider name
      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));

      if (!provider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cloud provider not found",
        });
      }

      // Get compute provider and terminate the workspace
      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
      await finalizeWorkspaceAgentRuns(input.workspaceId, userId);
      const terminateInBackground = provider.providerKey === "aws";
      const externalVolumeId = fetchedWorkspace.persistent
        ? fetchedWorkspace.volume.externalVolumeId
        : undefined;
      const terminatedAt = new Date();

      const runTerminationCleanup = async () => {
        if (fetchedWorkspace.sshConnection) {
          await computeProvider
            .revokeWorkspaceSSHAccess({
              workspaceId: fetchedWorkspace.id,
              externalServiceId: fetchedWorkspace.externalInstanceId,
              connection: fetchedWorkspace.sshConnection,
            })
            .catch((error) => {
              console.warn("Failed to revoke workspace editor access during delete:", error);
            });
        }

        for (const exposedPort of Object.values(fetchedWorkspace.exposedPorts ?? {})) {
          if (exposedPort?.externalPortDomainId) {
            await computeProvider.removeExposedPortDomain(exposedPort.externalPortDomainId);
          }
        }

        await computeProvider.terminateWorkspace(
          fetchedWorkspace.externalInstanceId,
          externalVolumeId,
        );

        await updateWorkspaceRoutingAndInvalidate(
          fetchedWorkspace.id,
          {
            externalInstanceId: "",
            externalRunningDeploymentId: null,
            upstreamUrl: null,
            exposedPorts: null,
            updatedAt: new Date(),
          },
          fetchedWorkspace.subdomain,
        );
      };

      if (!terminateInBackground) {
        await runTerminationCleanup();
      }

      const [updatedWorkspace] = await updateWorkspaceByIdReturningAndInvalidate(
        input.workspaceId,
        {
          status: "terminated",
          pausedAt: terminatedAt,
          terminatedAt,
          exposedPorts: null,
          sshConnection: null,
          updatedAt: terminatedAt,
        },
      );

      await deleteAllWorkspaceRouteAccess(input.workspaceId);

      // Delete volume record
      if (fetchedWorkspace.persistent) {
        await db.delete(volume).where(eq(volume.id, fetchedWorkspace.volume.id));
      }

      // Emit status event
      WORKSPACE_EVENTS.emitStatus({
        workspaceId: input.workspaceId,
        status: "terminated",
        updatedAt: terminatedAt,
        userId,
        workspaceDomain: fetchedWorkspace.domain,
      });

      if (terminateInBackground) {
        void runTerminationCleanup().catch((error) => {
          console.error(
            `Failed to finish background termination for workspace ${fetchedWorkspace.id}:`,
            error,
          );
        });
      }

      return {
        workspace: updatedWorkspace,
        success: true,
        cleanupInBackground: terminateInBackground,
      };
    }),

  openWorkspacePort: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        port: z.number(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const fetchedWorkspace = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const [provider] = await db
        .select()
        .from(cloudProvider)
        .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));

      if (!provider) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Cloud provider not found",
        });
      }

      const computeProvider = await getProviderByCloudProviderId(provider.providerKey);

      const { domain, externalPortDomainId, upstreamAccess } =
        await computeProvider.createOrGetExposedPortDomain(
          fetchedWorkspace.externalInstanceId,
          input.port,
        );

      await updateWorkspaceRoutingAndInvalidate(
        input.workspaceId,
        {
          exposedPorts: {
            ...fetchedWorkspace.exposedPorts,
            [input.port]: {
              port: input.port,
              name: input.name,
              upstreamUrl: domain,
              externalPortDomainId,
            },
          },
        },
        fetchedWorkspace.subdomain,
      );

      if (upstreamAccess?.headers) {
        await upsertWorkspaceRouteAccess(input.workspaceId, input.port, upstreamAccess.headers);
      } else {
        await deleteWorkspaceRouteAccess(input.workspaceId, input.port);
      }

      return {
        success: true,
        message: "Workspace port opened successfully",
      };
    }),

  closeWorkspacePort: protectedProcedure
    .input(z.object({ workspaceId: z.string(), port: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });
      }

      const fetchedWorkspace = await db.query.workspace.findFirst({
        where: and(eq(workspace.id, input.workspaceId), eq(workspace.userId, userId)),
      });

      if (!fetchedWorkspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const externalPortDomainId =
        fetchedWorkspace.exposedPorts?.[input.port]?.externalPortDomainId;
      if (externalPortDomainId) {
        const [provider] = await db
          .select()
          .from(cloudProvider)
          .where(eq(cloudProvider.id, fetchedWorkspace.cloudProviderId));

        if (!provider) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Cloud provider not found",
          });
        }

        const computeProvider = await getProviderByCloudProviderId(provider.providerKey);
        await computeProvider.removeExposedPortDomain(externalPortDomainId);
      }

      await updateWorkspaceRoutingAndInvalidate(
        input.workspaceId,
        {
          exposedPorts: {
            ...fetchedWorkspace.exposedPorts,
            [input.port]: undefined,
          },
        },
        fetchedWorkspace.subdomain,
      );

      await deleteWorkspaceRouteAccess(input.workspaceId, input.port);

      return {
        success: true,
        message: "Workspace port closed successfully",
      };
    }),
});
