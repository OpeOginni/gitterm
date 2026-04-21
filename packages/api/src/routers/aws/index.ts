import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db, eq, and, ne } from "@gitterm/db";
import { cloudProvider, region } from "@gitterm/db/schema/cloud";
import { providerConfig, providerType } from "@gitterm/db/schema/provider-config";
import { workspace } from "@gitterm/db/schema/workspace";
import { adminProcedure, router } from "../..";
import { bootstrapAwsProvider, deleteAwsProviderInfrastructure } from "../../providers/aws/setup";
import { getProviderConfigService } from "../../service/config/provider-config";

const AWS_REGION_METADATA: Record<string, { name: string; location: string }> = {
  "us-east-1": { name: "US East (N. Virginia)", location: "Virginia, USA" },
  "us-west-2": { name: "US West (Oregon)", location: "Oregon, USA" },
  "eu-west-1": { name: "EU (Ireland)", location: "Ireland" },
  "eu-central-1": { name: "EU (Frankfurt)", location: "Frankfurt, Germany" },
  "ap-northeast-1": { name: "Asia Pacific (Tokyo)", location: "Tokyo, Japan" },
};

const bootstrapAwsProviderSchema = z.object({
  providerId: z.uuid(),
  configName: z.string().min(1).optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  defaultRegion: z.string().optional(),
});

const deleteAwsInfrastructureSchema = z.object({
  providerId: z.uuid(),
});

export const awsRouter = router({
  bootstrap: adminProcedure.input(bootstrapAwsProviderSchema).mutation(async ({ input }) => {
    const provider = await db.query.cloudProvider.findFirst({
      where: eq(cloudProvider.id, input.providerId),
    });

    if (!provider) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
    }

    if (provider.name.toLowerCase() !== "aws") {
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

    const accessKeyId =
      String(input.accessKeyId ?? "").trim() || String(existingConfig?.config.accessKeyId ?? "").trim();
    const secretAccessKey =
      String(input.secretAccessKey ?? "").trim() ||
      String(existingConfig?.config.secretAccessKey ?? "").trim();
    const defaultRegion =
      String(input.defaultRegion ?? "").trim() || String(existingConfig?.config.defaultRegion ?? "").trim();

    if (!accessKeyId || !secretAccessKey || !defaultRegion) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "AWS access key, secret key, and default region are required.",
      });
    }

    let bootstrapResult;
    try {
      bootstrapResult = await bootstrapAwsProvider({
        accessKeyId,
        secretAccessKey,
        defaultRegion,
      });
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

    const persistedConfigForDisplay =
      await providerConfigService.getProviderConfigByIdForDisplay(savedConfig.id);
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
      where: eq(region.externalRegionIdentifier, defaultRegion),
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
      const regionMetadata = AWS_REGION_METADATA[defaultRegion] ?? {
        name: defaultRegion,
        location: defaultRegion,
      };

      await db.insert(region).values({
        cloudProviderId: provider.id,
        name: regionMetadata.name,
        location: regionMetadata.location,
        externalRegionIdentifier: defaultRegion,
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

      if (provider.name.toLowerCase() !== "aws") {
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

      const unresolvedCleanupCount = await db.$count(
        workspace,
        and(
          eq(workspace.cloudProviderId, provider.id),
          eq(workspace.status, "terminated"),
          ne(workspace.externalInstanceId, ""),
        ),
      );

      if (activeWorkspaceCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Delete AWS workspaces using this provider before deleting the infrastructure.",
        });
      }

      if (unresolvedCleanupCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Wait for background AWS cleanup to finish before deleting the shared infrastructure.",
        });
      }

      const providerConfigService = getProviderConfigService();
      const currentConfig = await providerConfigService.getProviderConfigById(provider.providerConfigId);

      if (!currentConfig) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "AWS provider config not found.",
        });
      }

      const accessKeyId = String(currentConfig.config.accessKeyId ?? "").trim();
      const secretAccessKey = String(currentConfig.config.secretAccessKey ?? "").trim();
      const defaultRegion = String(currentConfig.config.defaultRegion ?? "").trim();

      if (!accessKeyId || !secretAccessKey || !defaultRegion) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AWS credentials and default region are required to delete the infrastructure.",
        });
      }

      const deleteResult = await deleteAwsProviderInfrastructure({
        accessKeyId,
        secretAccessKey,
        defaultRegion,
      });

      await db
        .update(providerConfig)
        .set({
          configMetadata: { defaultRegion },
          isEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(providerConfig.id, provider.providerConfigId));

      await db
        .update(cloudProvider)
        .set({
          isEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(cloudProvider.id, provider.id));

      const persistedConfig = await providerConfigService.getProviderConfigByIdForDisplay(
        provider.providerConfigId,
      );
      if (!persistedConfig) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AWS provider config could not be reloaded after delete.",
        });
      }

      return {
        success: true,
        deleted: deleteResult.deleted,
        stackName: deleteResult.stackName,
        config: persistedConfig.config,
      };
    }),
});
