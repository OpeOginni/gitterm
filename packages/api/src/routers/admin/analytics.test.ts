import { expect, test } from "bun:test";
import { analyticsRouter } from "./analytics";
import { unlimitedBilling } from "../../billing";
import { isManaged } from "../../config/deployment";

const request = { report: "data_quality" as const, from: "2026-01-01", to: "2026-02-01" };
const admin = analyticsRouter.createCaller({
  session: { user: { id: "admin", role: "admin" } },
} as any);

test("only an admin browser session can read analytics", async () => {
  const anonymous = analyticsRouter.createCaller({ session: null } as any);
  await expect(anonymous.report({ request })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const user = analyticsRouter.createCaller({
    session: { user: { id: "user", role: "user" } },
  } as any);
  await expect(user.report({ request })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(user.simulate({ from: "2026-01-01", to: "2026-02-01" })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

test("reports reject unbounded ranges and row counts", async () => {
  await expect(
    admin.report({ request: { ...request, from: "2024-01-01", to: "2026-01-01" } }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(admin.report({ request: { ...request, limit: 100_000 } })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(
    admin.report({ request: { ...request, report: "raw_sql" as never } }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

test.skipIf(isManaged())("self-hosted deployments have no analytics", async () => {
  // Self-hosted: billing (and its analytics) is never loaded.
  await expect(admin.report({ request })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await unlimitedBilling.getReport({ ...request })).toBeNull();
  expect(
    await unlimitedBilling.simulatePricing({ from: "2026-01-01", to: "2026-02-01" }),
  ).toBeNull();
  await unlimitedBilling.recordObservation({
    type: "provision_result",
    userId: "user",
    workspaceId: null,
    providerKey: "e2b",
    outcome: "success",
    latencyMs: 1,
  });
});
