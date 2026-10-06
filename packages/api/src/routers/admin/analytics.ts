/**
 * Read-only business analytics for admins (and analysis agents acting
 * through an admin session). Curated reports only: no arbitrary SQL, bounded
 * date ranges and row counts, read-only transactions with a timeout.
 * Managed deployments only; self-hosted deployments have no billing data.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../..";
import { getBilling } from "../../billing";
import {
  analyticsReportRequestSchema,
  pricingScenarioSchema,
  reportToCsv,
} from "@gitterm/schema/billing-analytics";

const notEnabled = () =>
  new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing analytics are not enabled" });

export const analyticsRouter = router({
  report: adminProcedure
    .input(
      z.object({
        request: analyticsReportRequestSchema,
        format: z.enum(["json", "csv"]).default("json"),
      }),
    )
    .query(async ({ input, ctx }) => {
      const report = await (await getBilling()).getReport(input.request);
      if (!report) throw notEnabled();
      if (input.request.report === "account_periods") {
        // Per-account (pseudonymous) rows: keep an access trail.
        console.info(
          `[analytics] admin ${ctx.session.user.id} read account_periods ${input.request.from}..${input.request.to}`,
        );
      }
      return input.format === "csv" ? { report, csv: reportToCsv(report) } : { report, csv: null };
    }),

  simulate: adminProcedure.input(pricingScenarioSchema).query(async ({ input }) => {
    const simulation = await (await getBilling()).simulatePricing(input);
    if (!simulation) throw notEnabled();
    return simulation;
  }),
});
