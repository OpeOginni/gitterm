import { db, eq, inArray } from "@gitterm/db";
import { cloudProvider, image, machineProfile } from "@gitterm/db/schema/cloud";
import env, { isComputeEnabled } from "@gitterm/env/server";

/** The provider key of gitterm.dev's own sandboxes. */
export const COMPUTE_PROVIDER_KEY = "gitterm";

/** The sizes gitterm.dev sells. */
const SIZES = [
  { key: "small", name: "Small", vcpus: 2, memoryGb: 4, isDefault: false },
  { key: "medium", name: "Medium", vcpus: 4, memoryGb: 8, isDefault: true },
  { key: "large", name: "Large", vcpus: 8, memoryGb: 16, isDefault: false },
] as const;

/** Workspaces keep their files while paused (always persistent), have no SSH, and are ready
 * when creation returns. */
const PROVIDER = {
  providerKey: COMPUTE_PROVIDER_KEY,
  isSandbox: true,
  supportsRegions: false,
  allowUserRegionSelection: false,
  supportsPersistence: true,
  autoPersistent: true,
  supportServerOnly: true,
  machineSelectionPolicy: { mode: "profiles" as const },
  sshAccessSupport: {},
  creationSettlement: "immediate" as const,
  stopSettlement: "immediate" as const,
  restartSettlement: "immediate" as const,
  terminationSettlement: "immediate" as const,
};

/**
 * On gitterm.dev, makes sure the Gitterm provider, its sizes, and its images exist so plans,
 * billing, sandboxes and workspaces treat it like any provider. Does nothing on a self-hosted
 * deployment, so self-hosters never see it. Safe to run on every start; an admin's
 * enable/disable is kept.
 */
export async function ensureComputeProvider(): Promise<void> {
  if (!isComputeEnabled()) return;
  const [provider] = await db
    .insert(cloudProvider)
    .values({ name: "Gitterm", ...PROVIDER })
    .onConflictDoUpdate({ target: cloudProvider.name, set: { ...PROVIDER, updatedAt: new Date() } })
    .returning({ id: cloudProvider.id });
  for (const size of SIZES)
    await db
      .insert(machineProfile)
      .values({
        cloudProviderId: provider!.id,
        key: size.key,
        name: size.name,
        vcpus: size.vcpus,
        memoryGb: size.memoryGb,
        providerOptions: { size: size.key },
        isDefault: size.isDefault,
      })
      .onConflictDoNothing({ target: [machineProfile.cloudProviderId, machineProfile.key] });
  await markComputeImages();
}

/** Images the sandbox service can run become available on Gitterm, under the same name. */
async function markComputeImages(): Promise<void> {
  const response = await fetch(`${env.COMPUTE_URL!.replace(/\/$/, "")}/v1/images`, {
    headers: { authorization: `Bearer ${env.COMPUTE_SERVICE_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`listing images failed: ${response.status}`);
  const names = (await response.json()) as string[];
  if (!names.length) return;
  for (const row of await db.select().from(image).where(inArray(image.name, names))) {
    if ((row.providerMetadata?.gitterm as { image?: string } | undefined)?.image === row.name)
      continue;
    await db
      .update(image)
      .set({ providerMetadata: { ...row.providerMetadata, gitterm: { image: row.name } } })
      .where(eq(image.id, row.id));
  }
}
