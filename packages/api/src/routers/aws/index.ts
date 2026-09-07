import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db, eq, and, ne } from "@gitterm/db";
import { cloudProvider, machineProfile, region } from "@gitterm/db/schema/cloud";
import { providerConfig, providerType } from "@gitterm/db/schema/provider-config";
import { workspace } from "@gitterm/db/schema/workspace";
import { adminProcedure, router } from "../..";
import { normalizeAwsConfig } from "../../providers/aws";
import { bootstrapAwsProvider, deleteAwsProviderInfrastructure } from "../../providers/aws/setup";
import { awsTaskRoleNameSchema } from "../../providers/aws/task-role";
import { runAwsCleanupSweep } from "../../providers/aws/reconcile";
import { getProviderConfigService } from "../../service/config/provider-config";
import { awsRoleSelectionSchema } from "@gitterm/schema";
import { prepareAwsTaskRole, inspectAwsTaskRole } from "../../providers/aws/iam";
import { getAwsAccessProfiles } from "../../providers/aws/access-profiles";
import { buildAwsDeploymentPolicy } from "../../providers/aws/deployment-policy";

const AWS_REGION_METADATA: Record<string, { name: string; location: string; flag: string }> = {
  "us-east-1": {
    name: "US East (N. Virginia)",
    location: "Virginia, USA",
    flag: "🇺🇸",
  },
  "us-east-2": { name: "US East (Ohio)", location: "Ohio, USA", flag: "🇺🇸" },
  "us-west-1": {
    name: "US West (N. California)",
    location: "California, USA",
    flag: "🇺🇸",
  },
  "us-west-2": {
    name: "US West (Oregon)",
    location: "Oregon, USA",
    flag: "🇺🇸",
  },
  "ca-central-1": {
    name: "Canada (Central)",
    location: "Montréal, Canada",
    flag: "🇨🇦",
  },
  "sa-east-1": {
    name: "South America (São Paulo)",
    location: "São Paulo, Brazil",
    flag: "🇧🇷",
  },
  "eu-west-1": { name: "EU (Ireland)", location: "Ireland", flag: "🇮🇪" },
  "eu-west-2": { name: "EU (London)", location: "London, UK", flag: "🇬🇧" },
  "eu-west-3": { name: "EU (Paris)", location: "Paris, France", flag: "🇫🇷" },
  "eu-central-1": {
    name: "EU (Frankfurt)",
    location: "Frankfurt, Germany",
    flag: "🇩🇪",
  },
  "eu-north-1": {
    name: "EU (Stockholm)",
    location: "Stockholm, Sweden",
    flag: "🇸🇪",
  },
  "eu-south-1": { name: "EU (Milan)", location: "Milan, Italy", flag: "🇮🇹" },
  "ap-northeast-1": {
    name: "Asia Pacific (Tokyo)",
    location: "Tokyo, Japan",
    flag: "🇯🇵",
  },
  "ap-northeast-2": {
    name: "Asia Pacific (Seoul)",
    location: "Seoul, South Korea",
    flag: "🇰🇷",
  },
  "ap-southeast-1": {
    name: "Asia Pacific (Singapore)",
    location: "Singapore",
    flag: "🇸🇬",
  },
  "ap-southeast-2": {
    name: "Asia Pacific (Sydney)",
    location: "Sydney, Australia",
    flag: "🇦🇺",
  },
  "ap-south-1": {
    name: "Asia Pacific (Mumbai)",
    location: "Mumbai, India",
    flag: "🇮🇳",
  },
  "me-south-1": {
    name: "Middle East (Bahrain)",
    location: "Bahrain",
    flag: "🇧🇭",
  },
  "af-south-1": {
    name: "Africa (Cape Town)",
    location: "Cape Town, South Africa",
    flag: "🇿🇦",
  },
};

const createAwsRegionProviderSchema = z.object({
  regionIdentifier: z
    .string()
    .min(1, "Region is required")
    .regex(/^[a-z]{2}-[a-z]+-\d+$/i, "Invalid AWS region identifier"),
  name: z.string().min(1).optional(),
});

const bootstrapAwsProviderSchema = z.object({
  providerId: z.uuid(),
  configName: z.string().min(1).optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  defaultRegion: z.string().optional(),
  publicSshEnabled: z.boolean().optional(),
  taskRoleName: awsTaskRoleNameSchema.optional(),
  taskRole: awsRoleSelectionSchema.optional(),
});

const deleteAwsInfrastructureSchema = z.object({
  providerId: z.uuid(),
  preserveProvider: z.boolean().default(false),
});

function resolveAwsSetupInput(input: {
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
  defaultRegion?: unknown;
  publicSshEnabled?: unknown;
  taskRoleName?: string;
}): {
  accessKeyId: string;
  secretAccessKey: string;
  defaultRegion: string;
  publicSshEnabled: boolean;
  taskRoleName?: string;
} {
  const config = normalizeAwsConfig(input as Record<string, any>);
  return {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    defaultRegion: config.defaultRegion,
    publicSshEnabled: input.publicSshEnabled === undefined ? true : input.publicSshEnabled === true,
    taskRoleName: input.taskRoleName,
  };
}

function preferSubmittedValue(submitted: unknown, existing: unknown): unknown {
  const submittedValue = String(submitted ?? "").trim();
  return submittedValue || existing;
}

async function loadAwsProfileConfig(providerId: string) {
  const provider = await db.query.cloudProvider.findFirst({
    where: eq(cloudProvider.id, providerId),
  });
  if (provider?.providerKey !== "aws" || !provider.providerConfigId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Configure this AWS provider before adding access profiles",
    });
  const service = getProviderConfigService();
  const config = await service.getProviderConfigById(provider.providerConfigId);
  if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "AWS config not found" });
  return { config, service };
}

export const awsRouter = router({
  deploymentPolicy: adminProcedure
    .input(
      z.object({
        accountId: z.string().regex(/^\d{12}$/),
        region: z
          .string()
          .refine((value) => value in AWS_REGION_METADATA, "Select a supported AWS region"),
        role: awsRoleSelectionSchema,
      }),
    )
    .query(({ input }) => {
      const roleArn =
        input.role.mode === "existing"
          ? input.role.arn
          : `arn:aws:iam::${input.accountId}:role/${input.role.name || `gitterm-task-${input.region}`}`;
      if (!roleArn.startsWith(`arn:aws:iam::${input.accountId}:role/`)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The task role must belong to this AWS account.",
        });
      }
      return {
        policy: JSON.stringify(
          buildAwsDeploymentPolicy(input.accountId, input.region, roleArn, input.role.mode),
          null,
          2,
        ),
      };
    }),
  addAccessProfile: adminProcedure
    .input(
      z.object({
        providerId: z.uuid(),
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).default(""),
        role: awsRoleSelectionSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const { config, service } = await loadAwsProfileConfig(input.providerId);
      const profiles = getAwsAccessProfiles(config.config);
      if (profiles.length >= 50)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maximum 50 AWS access profiles per provider",
        });
      if (profiles.some((profile) => profile.name.toLowerCase() === input.name.toLowerCase()))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An access profile with this name already exists",
        });
      const check = await prepareAwsTaskRole(normalizeAwsConfig(config.config), input.role);
      const profile = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description,
        roleArn: check.roleArn,
      };
      try {
        await service.updateProviderConfig(
          config.id,
          { config: { accessProfiles: [...profiles, profile] } },
          config.updatedAt,
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not save access profile. Role ${check.roleArn} remains in AWS; retry using its ARN.`,
          cause: error,
        });
      }
      return { profile, check };
    }),

  checkAccessRole: adminProcedure
    .input(z.object({ providerId: z.uuid(), profileId: z.uuid().optional() }))
    .mutation(async ({ input }) => {
      const { config } = await loadAwsProfileConfig(input.providerId);
      const profile = input.profileId
        ? getAwsAccessProfiles(config.config).find((entry) => entry.id === input.profileId)
        : undefined;
      if (input.profileId && !profile)
        throw new TRPCError({ code: "NOT_FOUND", message: "Access profile not found" });
      return inspectAwsTaskRole(
        normalizeAwsConfig(config.config),
        profile?.roleArn ?? String(config.config.taskRoleArn),
      );
    }),

  removeAccessProfile: adminProcedure
    .input(z.object({ providerId: z.uuid(), profileId: z.uuid() }))
    .mutation(async ({ input }) => {
      const { config, service } = await loadAwsProfileConfig(input.providerId);
      await service.updateProviderConfig(
        config.id,
        {
          config: {
            accessProfiles: getAwsAccessProfiles(config.config).filter(
              (profile) => profile.id !== input.profileId,
            ),
          },
        },
        config.updatedAt,
      );
      return { success: true };
    }),
  listSupportedRegions: adminProcedure.query(async () => {
    const existing = await db.query.cloudProvider.findMany({
      where: eq(cloudProvider.providerKey, "aws"),
      with: {
        regions: true,
      },
    });

    // A region is considered "in use" if any AWS provider has it as one of its
    // regions (each region-provider row should have exactly one).
    const usedRegions = new Set<string>();
    for (const aws of existing) {
      for (const r of aws.regions) {
        usedRegions.add(r.externalRegionIdentifier);
      }
    }

    return Object.entries(AWS_REGION_METADATA).map(([identifier, meta]) => ({
      identifier,
      name: meta.name,
      location: meta.location,
      flag: meta.flag,
      inUse: usedRegions.has(identifier),
    }));
  }),

  createRegionProvider: adminProcedure
    .input(createAwsRegionProviderSchema)
    .mutation(async ({ input }) => {
      const meta = AWS_REGION_METADATA[input.regionIdentifier];

      if (!meta) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `AWS region "${input.regionIdentifier}" is not supported yet.`,
        });
      }

      const desiredName = input.name?.trim() || `AWS ${meta.name}`;

      const existingByName = await db.query.cloudProvider.findFirst({
        where: eq(cloudProvider.name, desiredName),
      });

      if (existingByName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A provider named "${desiredName}" already exists. Pick a different label.`,
        });
      }

      const existingForRegion = await db.query.cloudProvider.findMany({
        where: eq(cloudProvider.providerKey, "aws"),
        with: { regions: true },
      });

      for (const aws of existingForRegion) {
        if (aws.regions.some((r) => r.externalRegionIdentifier === input.regionIdentifier)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `An AWS provider for ${meta.name} already exists ("${aws.name}").`,
          });
        }
      }

      const [created] = await db
        .insert(cloudProvider)
        .values({
          name: desiredName,
          providerKey: "aws",
          isEnabled: false,
          supportsRegions: true,
          allowUserRegionSelection: false,
          sshAccessSupport: {
            supported: true,
            transportKind: "direct-ssh",
            label: "Native SSH",
            description: "Connect directly to the ECS task public IP for editor access.",
          },
          creationSettlement: "immediate",
          stopSettlement: "immediate",
          restartSettlement: "immediate",
          terminationSettlement: "immediate",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create AWS region provider.",
        });
      }

      await db.insert(region).values({
        cloudProviderId: created.id,
        name: meta.name,
        location: meta.location,
        externalRegionIdentifier: input.regionIdentifier,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(machineProfile).values({
        cloudProviderId: created.id,
        key: "standard",
        name: "Standard",
        description: "1 vCPU and 2 GiB memory Fargate task.",
        providerOptions: { cpu: 1024, memory: 2048 },
        isDefault: true,
        isEnabled: true,
      });

      return {
        provider: created,
        regionIdentifier: input.regionIdentifier,
      };
    }),

  bootstrap: adminProcedure.input(bootstrapAwsProviderSchema).mutation(async ({ input }) => {
    const provider = await db.query.cloudProvider.findFirst({
      where: eq(cloudProvider.id, input.providerId),
    });

    if (!provider) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Provider not found",
      });
    }

    if (provider.providerKey !== "aws") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "AWS simple setup is only available for the AWS provider.",
      });
    }

    const awsProviderType = await db.query.providerType.findFirst({
      where: eq(providerType.name, "aws"),
    });

    if (!awsProviderType) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "AWS provider type not found.",
      });
    }

    const providerConfigService = getProviderConfigService();
    const existingConfig = provider.providerConfigId
      ? await providerConfigService.getProviderConfigById(provider.providerConfigId)
      : null;

    // For region-scoped AWS providers, the region is pinned to the region row
    // attached to this provider. Don't let the admin change it via the form.
    const attachedRegion = await db.query.region.findFirst({
      where: eq(region.cloudProviderId, provider.id),
    });

    const pinnedRegionIdentifier =
      attachedRegion?.externalRegionIdentifier ?? existingConfig?.config.defaultRegion;

    let setupInput;
    try {
      setupInput = resolveAwsSetupInput({
        accessKeyId: preferSubmittedValue(input.accessKeyId, existingConfig?.config.accessKeyId),
        secretAccessKey: preferSubmittedValue(
          input.secretAccessKey,
          existingConfig?.config.secretAccessKey,
        ),
        defaultRegion: preferSubmittedValue(pinnedRegionIdentifier, input.defaultRegion),
        publicSshEnabled: input.publicSshEnabled ?? existingConfig?.config.publicSshEnabled ?? true,
        taskRoleName:
          input.taskRoleName ??
          (typeof existingConfig?.config.taskRoleArn === "string"
            ? existingConfig.config.taskRoleArn.split("/").at(-1)
            : undefined),
      });
      setupInput = { ...setupInput, taskRole: input.taskRole };
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "AWS credentials are required.",
      });
    }

    let bootstrapResult;
    try {
      bootstrapResult = await bootstrapAwsProvider(setupInput);
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "AWS setup failed",
      });
    }

    const configName = input.configName?.trim() || `${provider.name} Default`;
    const savedConfig = provider.providerConfigId
      ? await providerConfigService.updateProviderConfig(provider.providerConfigId, {
          name: configName,
          config: bootstrapResult.config,
        })
      : await providerConfigService.createProviderConfig({
          providerTypeId: awsProviderType.id,
          name: configName,
          config: bootstrapResult.config,
          isDefault: true,
        });

    if (!provider.providerConfigId) {
      await db
        .update(cloudProvider)
        .set({
          providerConfigId: savedConfig.id,
          updatedAt: new Date(),
        })
        .where(eq(cloudProvider.id, provider.id));
    }

    if (!savedConfig.isEnabled) {
      await providerConfigService.toggleProviderConfig(savedConfig.id, true);
    }

    const persistedConfig = await providerConfigService.getProviderConfigById(savedConfig.id);
    if (!persistedConfig) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "AWS provider config was saved but could not be reloaded.",
      });
    }

    const persistedConfigForDisplay = await providerConfigService.getProviderConfigByIdForDisplay(
      savedConfig.id,
    );
    if (!persistedConfigForDisplay) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "AWS provider config was saved but display config could not be reloaded.",
      });
    }

    const fieldsToVerify: Array<keyof typeof bootstrapResult.config> = [
      "clusterArn",
      "albBaseUrl",
      "albListenerArn",
      "securityGroupIds",
      "efsFileSystemId",
      "taskRoleArn",
    ];

    for (const field of fieldsToVerify) {
      if (persistedConfig.config[field] !== bootstrapResult.config[field]) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AWS setup completed but persisted config mismatch on ${field}.`,
        });
      }
    }

    await db
      .update(cloudProvider)
      .set({
        providerConfigId: savedConfig.id,
        allowUserRegionSelection: false,
        updatedAt: new Date(),
      })
      .where(eq(cloudProvider.id, provider.id));

    await db
      .update(region)
      .set({
        isEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(region.cloudProviderId, provider.id));

    const selectedRegion = await db.query.region.findFirst({
      where: and(
        eq(region.cloudProviderId, provider.id),
        eq(region.externalRegionIdentifier, setupInput.defaultRegion),
      ),
    });

    if (selectedRegion) {
      await db
        .update(region)
        .set({
          isEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(region.id, selectedRegion.id));
    } else {
      const regionMetadata = AWS_REGION_METADATA[setupInput.defaultRegion] ?? {
        name: setupInput.defaultRegion,
        location: setupInput.defaultRegion,
      };

      await db.insert(region).values({
        cloudProviderId: provider.id,
        name: regionMetadata.name,
        location: regionMetadata.location,
        externalRegionIdentifier: setupInput.defaultRegion,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return {
      providerConfigId: savedConfig.id,
      config: persistedConfigForDisplay.config,
      summary: bootstrapResult.summary,
      roleCheck: bootstrapResult.roleCheck,
    };
  }),

  deleteInfrastructure: adminProcedure
    .input(deleteAwsInfrastructureSchema)
    .mutation(async ({ input }) => {
      const provider = await db.query.cloudProvider.findFirst({
        where: eq(cloudProvider.id, input.providerId),
      });

      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Provider not found",
        });
      }

      if (provider.providerKey !== "aws") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AWS infrastructure delete is only available for the AWS provider.",
        });
      }

      if (!provider.providerConfigId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AWS provider is not configured.",
        });
      }

      const activeWorkspaceCount = await db.$count(
        workspace,
        and(eq(workspace.cloudProviderId, provider.id), ne(workspace.status, "terminated")),
      );

      if (activeWorkspaceCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Delete AWS workspaces using this provider before deleting the infrastructure.",
        });
      }

      await runAwsCleanupSweep();

      const unresolvedCleanupCount = await db.$count(
        workspace,
        and(
          eq(workspace.cloudProviderId, provider.id),
          eq(workspace.status, "terminated"),
          ne(workspace.externalInstanceId, ""),
        ),
      );

      if (unresolvedCleanupCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Wait for background AWS cleanup to finish before deleting the shared infrastructure.",
        });
      }

      const providerConfigService = getProviderConfigService();
      const currentConfig = await providerConfigService.getProviderConfigById(
        provider.providerConfigId,
      );

      if (!currentConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "AWS provider config not found.",
        });
      }

      let setupInput;
      try {
        setupInput = resolveAwsSetupInput(currentConfig.config);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "AWS credentials are required.",
        });
      }

      const deleteResult = await deleteAwsProviderInfrastructure(setupInput);

      await db.transaction(async (tx) => {
        if (input.preserveProvider) {
          // Reset must keep the provider ID, region, machine profiles and encrypted credentials.
          // Disable the config until bootstrap succeeds so a failed reset cannot launch tasks.
          await tx
            .update(providerConfig)
            .set({ isEnabled: false, updatedAt: new Date() })
            .where(eq(providerConfig.id, provider.providerConfigId!));
        } else {
          await tx.delete(cloudProvider).where(eq(cloudProvider.id, provider.id));
          await tx.delete(providerConfig).where(eq(providerConfig.id, provider.providerConfigId!));
        }
      });

      return {
        success: true,
        deleted: deleteResult.deleted,
        stackName: deleteResult.stackName,
        deletedProviderId: input.preserveProvider ? null : provider.id,
      };
    }),
});
