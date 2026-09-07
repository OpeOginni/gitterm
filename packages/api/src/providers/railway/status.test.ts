import { describe, expect, spyOn, test } from "bun:test";
import { DeploymentStatus } from "./graphql/generated/railway";
import { RailwayProvider, railwayDeploymentStatus } from "./index";
import type { RailwayConfig } from "./types";

describe("Railway deployment status", () => {
  test.each([
    [DeploymentStatus.Success, "running"],
    [DeploymentStatus.Deploying, "pending"],
    [DeploymentStatus.Crashed, "paused"],
    [DeploymentStatus.Failed, "paused"],
    [DeploymentStatus.Removed, "terminated"],
  ] as const)("maps %s to %s", (deployment, workspace) => {
    expect(railwayDeploymentStatus(deployment).status).toBe(workspace);
  });

  test("includes the deployment ID when Railway returns one", () => {
    expect(railwayDeploymentStatus(DeploymentStatus.Success, "deployment-1")).toEqual({
      status: "running",
      externalRunningDeploymentId: "deployment-1",
    });
  });

  test("maps a stopped successful deployment to paused", () => {
    expect(railwayDeploymentStatus(DeploymentStatus.Success, "deployment-1", true)).toEqual({
      status: "paused",
      externalRunningDeploymentId: "deployment-1",
    });
  });

  test("resolves the latest deployment when pause receives no stored ID", async () => {
    const provider = new RailwayProvider();
    const stopped: string[] = [];
    const railway = {
      ServiceDeploymentStatus: async () => ({
        service: {
          deployments: {
            edges: [
              {
                node: {
                  id: "deployment-1",
                  status: DeploymentStatus.Success,
                  deploymentStopped: false,
                },
              },
            ],
          },
        },
      }),
      DeploymentStop: async ({ id }: { id: string }) => {
        stopped.push(id);
        return { deploymentStop: true };
      },
    };
    const config = spyOn(provider, "getConfig").mockResolvedValue({
      environmentId: "environment-1",
    } as RailwayConfig);
    const client = spyOn(
      provider as RailwayProvider & { getClient(): Promise<typeof railway> },
      "getClient",
    ).mockResolvedValue(railway);

    try {
      await provider.pauseWorkspace("service-1", "region-1");
      expect(stopped).toEqual(["deployment-1"]);
    } finally {
      config.mockRestore();
      client.mockRestore();
    }
  });
});
