import { z } from "zod";
import { db, sql } from "@gitterm/db";
import { billingProviderCost, billingProviderCostRate } from "@gitterm/db/schema/billing-analytics";

/**
 * Import format for provider costs that can't be ingested automatically
 * (invoices, usage exports). Amounts are decimal currency units and are
 * stored as micros. Unknown amounts stay null; they are never assumed zero.
 */
const money = z.number().finite().nullable().optional();
const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

export const providerCostImportSchema = z
  .object({
    /** Estimated cost per hour by machine profile, separate from retail prices. */
    costRates: z
      .array(
        z
          .object({
            machineProfileId: z.uuid(),
            /** Decimal amount per hour, or null to mark the size's cost unknown from now on. */
            perHour: money,
            currency: z.string().length(3),
            effectiveFrom: isoDateTime,
            source: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
    costs: z
      .array(
        z
          .object({
            providerKey: z.string().min(1).max(32),
            sourceRecordId: z.string().min(1).max(200),
            accountRef: z.string().max(200).nullable().optional(),
            scope: z.enum(["direct", "shared"]),
            category: z.enum([
              "compute",
              "storage",
              "network",
              "subscription",
              "commitment",
              "platform",
              "other",
            ]),
            periodStart: isoDateTime,
            periodEnd: isoDateTime,
            quantity: z.number().finite().nullable().optional(),
            unit: z.string().max(32).nullable().optional(),
            currency: z.string().length(3),
            estimated: money,
            invoiced: money,
            credits: money,
            cash: money,
            status: z.enum(["estimated", "invoiced", "reconciled"]),
            note: z.string().max(500).nullable().optional(),
          })
          .strict()
          .refine((cost) => Date.parse(cost.periodEnd) > Date.parse(cost.periodStart), {
            message: "periodEnd must be after periodStart",
          })
          .refine((cost) => cost.status === "estimated" || cost.invoiced != null, {
            message: "Invoiced and reconciled costs need an invoiced amount",
          }),
      )
      .max(10_000)
      .default([]),
  })
  .strict();

export type ProviderCostImport = z.infer<typeof providerCostImportSchema>;

const toMicros = (value: number | null | undefined) =>
  value == null ? null : Math.round(value * 1_000_000);

/**
 * Upsert costs by (provider, source record id), so re-importing a corrected
 * file updates rows instead of duplicating them. Cost rates are appended
 * (effective-dated); an identical rate is not added twice.
 */
export async function importProviderCosts(
  input: ProviderCostImport,
  options: { dryRun: boolean },
): Promise<{ costs: number; costRates: number }> {
  if (options.dryRun) return { costs: input.costs.length, costRates: input.costRates.length };

  await db.transaction(async (tx) => {
    for (const rate of input.costRates) {
      const effectiveFrom = new Date(rate.effectiveFrom);
      const microsPerHour = toMicros(rate.perHour);
      const existing = await tx.execute(sql`
        select 1 from billing_provider_cost_rate
        where machine_profile_id = ${rate.machineProfileId}
          and effective_from = ${effectiveFrom.toISOString()}::timestamp
          and micros_per_hour is not distinct from ${microsPerHour}
        limit 1`);
      if (existing.rows.length > 0) continue;
      await tx.insert(billingProviderCostRate).values({
        machineProfileId: rate.machineProfileId,
        microsPerHour,
        currency: rate.currency.toUpperCase(),
        effectiveFrom,
        source: rate.source,
      });
    }

    for (const cost of input.costs) {
      const values = {
        providerKey: cost.providerKey,
        sourceRecordId: cost.sourceRecordId,
        accountRef: cost.accountRef ?? null,
        scope: cost.scope,
        category: cost.category,
        periodStart: new Date(cost.periodStart),
        periodEnd: new Date(cost.periodEnd),
        quantity: cost.quantity ?? null,
        unit: cost.unit ?? null,
        currency: cost.currency.toUpperCase(),
        estimatedMicros: toMicros(cost.estimated),
        invoicedMicros: toMicros(cost.invoiced),
        creditsMicros: toMicros(cost.credits),
        cashMicros: toMicros(cost.cash),
        status: cost.status,
        note: cost.note ?? null,
        updatedAt: new Date(),
      };
      await tx
        .insert(billingProviderCost)
        .values(values)
        .onConflictDoUpdate({
          target: [billingProviderCost.providerKey, billingProviderCost.sourceRecordId],
          set: values,
        });
    }
  });
  return { costs: input.costs.length, costRates: input.costRates.length };
}
