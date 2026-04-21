import { and, db, eq, ne } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import { awsProvider } from ".";

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
  const awsCloudProvider = await db.query.cloudProvider.findFirst({
    where: eq(cloudProvider.name, "AWS"),
  });

  if (!awsCloudProvider) {
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

  const [activeAwsWorkspaces, terminatedAwsWorkspaces] = await Promise.all([
    db
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(eq(workspace.cloudProviderId, awsCloudProvider.id), ne(workspace.status, "terminated")),
      ),
    db
      .select({
        id: workspace.id,
        externalInstanceId: workspace.externalInstanceId,
      })
      .from(workspace)
      .where(
        and(
          eq(workspace.cloudProviderId, awsCloudProvider.id),
          eq(workspace.status, "terminated"),
          ne(workspace.externalInstanceId, ""),
        ),
      ),
  ]);

  let retriedWorkspaces = 0;
  for (const terminatedWorkspace of terminatedAwsWorkspaces) {
    try {
      await awsProvider.terminateWorkspace(terminatedWorkspace.externalInstanceId);
      await db
        .update(workspace)
        .set({
          externalInstanceId: "",
          externalRunningDeploymentId: null,
          upstreamUrl: null,
          exposedPorts: null,
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, terminatedWorkspace.id));
      retriedWorkspaces += 1;
    } catch (error) {
      console.error(
        `[aws-reconcile] Failed to retry AWS termination for workspace ${terminatedWorkspace.id}:`,
        error,
      );
    }
  }

  const sweepResult = await awsProvider.sweepOrphanedResources(
    activeAwsWorkspaces.map((ws) => ws.id),
  );

  const unresolvedCleanupCount = await db.$count(
    workspace,
    and(
      eq(workspace.cloudProviderId, awsCloudProvider.id),
      eq(workspace.status, "terminated"),
      ne(workspace.externalInstanceId, ""),
    ),
  );

  return {
    retriedWorkspaces,
    unresolvedCleanupCount,
    ...sweepResult,
  };
}
