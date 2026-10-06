import { and, db, desc, inArray, lte } from "@gitterm/db";
import { billingMachineRate } from "@gitterm/db/schema/billing";

/** Current hourly price of each priced machine profile, in millionths of a dollar. */
export async function getMachinePrices(
  machineProfileIds: string[],
  now = new Date(),
): Promise<Map<string, number>> {
  if (machineProfileIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([billingMachineRate.machineProfileId], {
      machineProfileId: billingMachineRate.machineProfileId,
      microsPerHour: billingMachineRate.microsPerHour,
    })
    .from(billingMachineRate)
    .where(
      and(
        inArray(billingMachineRate.machineProfileId, machineProfileIds),
        lte(billingMachineRate.effectiveFrom, now),
      ),
    )
    .orderBy(billingMachineRate.machineProfileId, desc(billingMachineRate.effectiveFrom));
  return new Map(
    rows.flatMap((row) =>
      row.microsPerHour === null ? [] : [[row.machineProfileId, row.microsPerHour] as const],
    ),
  );
}

/** Price sessions that start from now on; earlier usage keeps its price. */
export async function setMachinePrice(
  machineProfileId: string,
  microsPerHour: number | null,
): Promise<void> {
  // Stamp with the app clock, which getMachinePrices and billing compare against.
  await db
    .insert(billingMachineRate)
    .values({ machineProfileId, microsPerHour, effectiveFrom: new Date() });
}
