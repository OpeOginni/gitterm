import { and, db, eq, inArray, ne } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import { awsProvider } from ".";
import { updateWorkspaceRoutingAndInvalidate } from "../../service/workspace-mutations";

export interface AwsSweepResult {
  retriedWorkspaces: number;
  servicesDeleted: number;
  taskDefinitionsDeregistered: number;
  rulesDeleted: number;
  targetGroupsDeleted: number;
  accessPointsDeleted: number;
  unresolvedCleanupCount: number;
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
      servicesDeleted: 0,
      taskDefinitionsDeregistered: 0,
      rulesDeleted: 0,
      targetGroupsDeleted: 0,
      accessPointsDeleted: 0,
      unresolvedCleanupCount: 0,
    };
  }

  const awsProviderIds = awsCloudProviders.map((p) => p.id);

  const terminatedAwsWorkspaces = await db
    .select({
      id: workspace.id,
      externalInstanceId: workspace.externalInstanceId,
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
      await awsProvider.terminateWorkspace(terminatedWorkspace.externalInstanceId);
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

  let servicesDeleted = 0;
  let taskDefinitionsDeregistered = 0;
  let rulesDeleted = 0;
  let targetGroupsDeleted = 0;
  let accessPointsDeleted = 0;

  for (const provider of awsCloudProviders) {
    if (!provider.providerConfigId) {
      continue;
    }

    const pinnedRegion =
      provider.regions.find((region) => region.isEnabled) ??
      [...provider.regions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!pinnedRegion?.externalRegionIdentifier) {
      continue;
    }

    const activeProviderWorkspaces = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(eq(workspace.cloudProviderId, provider.id), ne(workspace.status, "terminated")),
      );

    try {
      const providerSweepResult = await awsProvider.sweepOrphanedResources(
        activeProviderWorkspaces.map((ws) => ws.id),
        pinnedRegion.externalRegionIdentifier,
      );

      servicesDeleted += providerSweepResult.servicesDeleted;
      taskDefinitionsDeregistered += providerSweepResult.taskDefinitionsDeregistered;
      rulesDeleted += providerSweepResult.rulesDeleted;
      targetGroupsDeleted += providerSweepResult.targetGroupsDeleted;
      accessPointsDeleted += providerSweepResult.accessPointsDeleted;
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
    servicesDeleted,
    taskDefinitionsDeregistered,
    rulesDeleted,
    targetGroupsDeleted,
    accessPointsDeleted,
  };
}
