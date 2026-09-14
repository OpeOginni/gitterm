import { and, db, eq, inArray, ne } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import { AwsProvider, type AwsCleanupFailure } from ".";
import { updateWorkspaceRoutingAndInvalidate } from "../../service/workspace-mutations";

export interface AwsSweepResult {
  retriedWorkspaces: number;
  runtimeSecretsDeleted: number;
  servicesDeleted: number;
  taskDefinitionsDeregistered: number;
  rulesDeleted: number;
  targetGroupsDeleted: number;
  accessPointsDeleted: number;
  unresolvedCleanupCount: number;
  /** Orphaned resources whose deletion failed this pass; the next sweep retries them. */
  cleanupFailures: AwsCleanupFailure[];
}

export async function runAwsCleanupSweep(): Promise<AwsSweepResult> {
  // Multiple cloud_provider rows can share providerKey = "aws" (one row per
  // configured AWS region). The sweep aggregates workspaces across all of them.
  const awsCloudProviders = await db.query.cloudProvider.findMany({
    where: eq(cloudProvider.providerKey, "aws"),
    with: {
      regions: true,
    },
  });

  if (awsCloudProviders.length === 0) {
    return {
      retriedWorkspaces: 0,
      runtimeSecretsDeleted: 0,
      servicesDeleted: 0,
      taskDefinitionsDeregistered: 0,
      rulesDeleted: 0,
      targetGroupsDeleted: 0,
      accessPointsDeleted: 0,
      unresolvedCleanupCount: 0,
      cleanupFailures: [],
    };
  }

  const awsProviderIds = awsCloudProviders.map((p) => p.id);

  const pending = await db.query.workspace.findMany({
    where: and(inArray(workspace.cloudProviderId, awsProviderIds), eq(workspace.status, "pending")),
  });
  for (const attempt of pending) {
    const lease = attempt.metadata?.awsProvisioningLeaseExpiresAt;
    if (lease && Date.parse(lease) < Date.now()) {
      await db
        .update(workspace)
        .set({ status: "terminated", updatedAt: new Date() })
        .where(
          and(
            eq(workspace.id, attempt.id),
            eq(workspace.status, "pending"),
            eq(workspace.updatedAt, attempt.updatedAt),
          ),
        );
    }
  }

  const terminatedAwsWorkspaces = await db
    .select({
      id: workspace.id,
      externalInstanceId: workspace.externalInstanceId,
      cloudProviderId: workspace.cloudProviderId,
    })
    .from(workspace)
    .where(
      and(
        inArray(workspace.cloudProviderId, awsProviderIds),
        eq(workspace.status, "terminated"),
        ne(workspace.externalInstanceId, ""),
      ),
    );

  let retriedWorkspaces = 0;
  for (const terminatedWorkspace of terminatedAwsWorkspaces) {
    try {
      await new AwsProvider(terminatedWorkspace.cloudProviderId).terminateWorkspace(
        terminatedWorkspace.externalInstanceId,
      );
      await updateWorkspaceRoutingAndInvalidate(terminatedWorkspace.id, {
        externalInstanceId: "",
        externalRunningDeploymentId: null,
        upstreamUrl: null,
        exposedPorts: null,
        updatedAt: new Date(),
      });
      retriedWorkspaces += 1;
    } catch (error) {
      console.error(
        `[aws-reconcile] Failed to retry AWS termination for workspace ${terminatedWorkspace.id}:`,
        error,
      );
    }
  }

  let runtimeSecretsDeleted = 0;
  let servicesDeleted = 0;
  let taskDefinitionsDeregistered = 0;
  let rulesDeleted = 0;
  let targetGroupsDeleted = 0;
  let accessPointsDeleted = 0;
  const cleanupFailures: AwsCleanupFailure[] = [];

  for (const provider of awsCloudProviders) {
    if (!provider.providerConfigId) {
      continue;
    }

    const pinnedRegion =
      provider.regions.find((region) => region.isEnabled) ??
      [...provider.regions].toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!pinnedRegion?.externalRegionIdentifier) {
      continue;
    }

    const activeProviderWorkspaces = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.cloudProviderId, provider.id), ne(workspace.status, "terminated")));

    try {
      const providerSweepResult = await new AwsProvider(provider.id).sweepOrphanedResources(
        activeProviderWorkspaces.map((ws) => ws.id),
        pinnedRegion.externalRegionIdentifier,
      );

      runtimeSecretsDeleted += providerSweepResult.runtimeSecretsDeleted;
      servicesDeleted += providerSweepResult.servicesDeleted;
      taskDefinitionsDeregistered += providerSweepResult.taskDefinitionsDeregistered;
      rulesDeleted += providerSweepResult.rulesDeleted;
      targetGroupsDeleted += providerSweepResult.targetGroupsDeleted;
      accessPointsDeleted += providerSweepResult.accessPointsDeleted;
      cleanupFailures.push(...providerSweepResult.failures);
    } catch (error) {
      console.error(
        `[aws-reconcile] Failed to sweep orphaned resources for provider ${provider.id} (${pinnedRegion.externalRegionIdentifier}):`,
        error,
      );
    }
  }

  const unresolvedCleanupCount = await db.$count(
    workspace,
    and(
      inArray(workspace.cloudProviderId, awsProviderIds),
      eq(workspace.status, "terminated"),
      ne(workspace.externalInstanceId, ""),
    ),
  );

  return {
    retriedWorkspaces,
    unresolvedCleanupCount,
    runtimeSecretsDeleted,
    servicesDeleted,
    taskDefinitionsDeregistered,
    rulesDeleted,
    targetGroupsDeleted,
    accessPointsDeleted,
    cleanupFailures,
  };
}
