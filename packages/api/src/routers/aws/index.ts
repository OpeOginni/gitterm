import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db, eq, and, ne } from "@gitterm/db";
import {
  cloudProvider,
  image,
  providerAgentImage,
  region,
} from "@gitterm/db/schema/cloud";
import { providerConfig, providerType } from "@gitterm/db/schema/provider-config";
import { workspace } from "@gitterm/db/schema/workspace";
import { adminProcedure, router } from "../..";
import { normalizeAwsConfig } from "../../providers/aws";
import { bootstrapAwsProvider, deleteAwsProviderInfrastructure } from "../../providers/aws/setup";
import { runAwsCleanupSweep } from "../../providers/aws/reconcile";
import { getProviderConfigService } from "../../service/config/provider-config";

const AWS_REGION_METADATA: Record<string, { name: string; location: string; flag: string }> = {
  "us-east-1": { name: "US East (N. Virginia)", location: "Virginia, USA", flag: "🇺🇸" },
  "us-east-2": { name: "US East (Ohio)", location: "Ohio, USA", flag: "🇺🇸" },
  "us-west-1": { name: "US West (N. California)", location: "California, USA", flag: "🇺🇸" },
  "us-west-2": { name: "US West (Oregon)", location: "Oregon, USA", flag: "🇺🇸" },
  "ca-central-1": { name: "Canada (Central)", location: "Montréal, Canada", flag: "🇨🇦" },
  "sa-east-1": { name: "South America (São Paulo)", location: "São Paulo, Brazil", flag: "🇧🇷" },
  "eu-west-1": { name: "EU (Ireland)", location: "Ireland", flag: "🇮🇪" },
  "eu-west-2": { name: "EU (London)", location: "London, UK", flag: "🇬🇧" },
  "eu-west-3": { name: "EU (Paris)", location: "Paris, France", flag: "🇫🇷" },
  "eu-central-1": { name: "EU (Frankfurt)", location: "Frankfurt, Germany", flag: "🇩🇪" },
  "eu-north-1": { name: "EU (Stockholm)", location: "Stockholm, Sweden", flag: "🇸🇪" },
  "eu-south-1": { name: "EU (Milan)", location: "Milan, Italy", flag: "🇮🇹" },
  "ap-northeast-1": { name: "Asia Pacific (Tokyo)", location: "Tokyo, Japan", flag: "🇯🇵" },
  "ap-northeast-2": { name: "Asia Pacific (Seoul)", location: "Seoul, South Korea", flag: "🇰🇷" },
  "ap-southeast-1": { name: "Asia Pacific (Singapore)", location: "Singapore", flag: "🇸🇬" },
  "ap-southeast-2": { name: "Asia Pacific (Sydney)", location: "Sydney, Australia", flag: "🇦🇺" },
  "ap-south-1": { name: "Asia Pacific (Mumbai)", location: "Mumbai, India", flag: "🇮🇳" },
  "me-south-1": { name: "Middle East (Bahrain)", location: "Bahrain", flag: "🇧🇭" },
  "af-south-1": { name: "Africa (Cape Town)", location: "Cape Town, South Africa", flag: "🇿🇦" },
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
});

const deleteAwsInfrastructureSchema = z.object({
  providerId: z.uuid(),
});

function resolveAwsSetupInput(input: {
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
  defaultRegion?: unknown;
  publicSshEnabled?: unknown;
}): {
  accessKeyId: string;
  secretAccessKey: string;
  defaultRegion: string;
  publicSshEnabled: boolean;
} {
  const config = normalizeAwsConfig(input as Record<string, any>);
  return {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    defaultRegion: config.defaultRegion,
    publicSshEnabled: input.publicSshEnabled === undefined ? true : input.publicSshEnabled === true,
  };
}

function preferSubmittedValue(submitted: unknown, existing: unknown): unknown {
  const submittedValue = String(submitted ?? "").trim();
  return submittedValue || existing;
}

export const awsRouter = router({
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
          editorAccessSupport: {
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

      // Copy AWS-compatible image assignments to the new provider.
      //
      // providerAgentImage is keyed by cloudProviderId, so every AWS region
      // provider needs its own (agentType -> image) assignments to be deployable.
      // We pick the set of images that carry AWS-specific provider metadata
      // (e.g. `providerMetadata.aws.cpu/memory/containerPort/...`) — those are
      // the images intended to run on AWS infrastructure.
      const allImages = await db.query.image.findMany({
        where: eq(image.isEnabled, true),
      });
      const awsImages = allImages.filter(
        (img) => img.providerMetadata && (img.providerMetadata as Record<string, unknown>).aws,
      );

      if (awsImages.length === 0) {
        console.warn(
          `[aws.createRegionProvider] No AWS-compatible images found. Provider "${created.name}" was created but has no image assignments — workspaces cannot be deployed against it until an image is assigned via the admin panel.`,
        );
      } else {
        // Use a single (agentType, image) per agentType to avoid violating the
        // (cloudProviderId, agentTypeId, workspaceProfile) unique index. If
        // multiple AWS images exist for the same agent type, the first one wins;
        // admins can change the assignment later in the admin panel.
        const seenAgentTypes = new Set<string>();
        for (const awsImage of awsImages) {
          if (seenAgentTypes.has(awsImage.agentTypeId)) continue;
          seenAgentTypes.add(awsImage.agentTypeId);

          await db.insert(providerAgentImage).values({
            cloudProviderId: created.id,
            agentTypeId: awsImage.agentTypeId,
            imageId: awsImage.id,
            workspaceProfile: null,
            isDefault: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

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
      throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
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
      });
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
    };
  }),

  deleteInfrastructure: adminProcedure
    .input(deleteAwsInfrastructureSchema)
    .mutation(async ({ input }) => {
      const provider = await db.query.cloudProvider.findFirst({
        where: eq(cloudProvider.id, input.providerId),
      });

      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
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
        await tx.delete(cloudProvider).where(eq(cloudProvider.id, provider.id));
        await tx.delete(providerConfig).where(eq(providerConfig.id, provider.providerConfigId!));
      });

      return {
        success: true,
        deleted: deleteResult.deleted,
        stackName: deleteResult.stackName,
        deletedProviderId: provider.id,
      };
    }),
});
