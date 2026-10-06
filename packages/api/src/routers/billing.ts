import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../index";
import { getBilling } from "../billing";
import { and, asc, db, eq } from "@gitterm/db";
import { cloudProvider, machineProfile } from "@gitterm/db/schema/cloud";

export const billingRouter = router({
  /** Public rate card: each enabled machine size's hourly price. Empty without billing. */
  rates: publicProcedure.query(async () => {
    const billing = await getBilling();
    if (!billing.enabled) return [];
    const sizes = await db
      .select({
        id: machineProfile.id,
        provider: cloudProvider.name,
        location: cloudProvider.location,
        name: machineProfile.name,
        vcpus: machineProfile.vcpus,
        memoryGb: machineProfile.memoryGb,
      })
      .from(machineProfile)
      .innerJoin(cloudProvider, eq(machineProfile.cloudProviderId, cloudProvider.id))
      .where(and(eq(machineProfile.isEnabled, true), eq(cloudProvider.isEnabled, true)))
      .orderBy(asc(cloudProvider.name), asc(machineProfile.vcpus));
    const prices = await billing.getMachinePrices(sizes.map((size) => size.id));
    return sizes.flatMap(({ id, ...size }) => {
      const priceMicrosPerHour = prices.get(id);
      return priceMicrosPerHour === undefined ? [] : [{ ...size, priceMicrosPerHour }];
    });
  }),

  /** The viewer's plan (null when billing is off) and what they may use. */
  account: protectedProcedure.query(async ({ ctx }) => {
    const billing = await getBilling();
    const [account, entitlements] = await Promise.all([
      billing.getAccount(ctx.session.user.id),
      billing.getEntitlements(ctx.session.user.id),
    ]);
    return { account, entitlements };
  }),

  /** Turn pay-as-you-go on or off, with the most overage the user accepts per period. */
  updateSettings: protectedProcedure
    .input(
      z.object({
        payAsYouGo: z.boolean(),
        spendCapCents: z.number().int().positive().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const billing = await getBilling();
      if (!billing.enabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Billing is not enabled" });
      }
      try {
        await billing.updateSettings(ctx.session.user.id, input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid billing settings",
        });
      }
      return { success: true };
    }),
});
