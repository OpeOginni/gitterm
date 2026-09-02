import { describe, expect, test } from "bun:test";
import { DeploymentStatus } from "./graphql/generated/railway";
import { railwayDeploymentStatus } from "./index";

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
});
