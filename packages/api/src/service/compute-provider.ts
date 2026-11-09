import { randomUUID } from "node:crypto";
import { and, db, eq, inArray, not } from "@gitterm/db";
import { cloudProvider, image, machineProfile } from "@gitterm/db/schema/cloud";
import { providerConfig, providerType } from "@gitterm/db/schema/provider-config";
import env, { isComputeEnabled } from "@gitterm/env/server";
import { getBilling } from "../billing";
import { encryptionContext, getEncryptionService } from "./encryption";

/** The provider key of gitterm.dev's own sandboxes. */
export const COMPUTE_PROVIDER_KEY = "gitterm";

/**
 * The sizes gitterm.dev sells. Others already in the database are disabled, not deleted.
 * `large` (8 vCPU, 16 GB) comes back once Compute has the machines.
 */
const SIZES = [
  { key: "small", name: "Small", vcpus: 2, memoryGb: 4, isDefault: false },
  { key: "medium", name: "Medium", vcpus: 4, memoryGb: 8, isDefault: true },
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
 * gitterm.dev only: makes sure the Gitterm provider, its sizes, and its images exist so plans,
 * billing, sandboxes and workspaces treat it like any provider. Run by
 * `scripts/setup-gitterm-compute.ts`, never by the server or the seed, so self-hosted
 * deployments never see it. Safe to rerun; an admin's enable/disable of a sold size is kept.
 */
export async function ensureComputeProvider(): Promise<void> {
  if (!isComputeEnabled())
    throw new Error(
      "Gitterm Compute is not configured: set DEPLOYMENT_MODE=managed, COMPUTE_URL and COMPUTE_SERVICE_TOKEN.",
    );
  const [provider] = await db
    .insert(cloudProvider)
    .values({ name: "Gitterm", ...PROVIDER })
    .onConflictDoUpdate({ target: cloudProvider.name, set: { ...PROVIDER, updatedAt: new Date() } })
    .returning({ id: cloudProvider.id });
  await ensureProviderConfig(provider!.id);
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
  // Disabled, not deleted: workspaces and billing history still point at them.
  await db
    .update(machineProfile)
    .set({ isEnabled: false, isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(machineProfile.cloudProviderId, provider!.id),
        not(
          inArray(
            machineProfile.key,
            SIZES.map((size) => size.key),
          ),
        ),
      ),
    );
  await warnUnpricedSizes(provider!.id);
  await markComputeImages();
}

/**
 * An empty provider config, so admin and workspace creation treat Gitterm like any configured
 * provider. Its real settings are the server's environment, so the config holds nothing.
 */
async function ensureProviderConfig(cloudProviderId: string): Promise<void> {
  const [type] = await db
    .insert(providerType)
    .values({
      name: COMPUTE_PROVIDER_KEY,
      displayName: "Gitterm",
      category: "both",
      configSchema: {},
    })
    .onConflictDoUpdate({ target: providerType.name, set: { updatedAt: new Date() } })
    .returning({ id: providerType.id });
  const [row] = await db
    .select({ providerConfigId: cloudProvider.providerConfigId })
    .from(cloudProvider)
    .where(eq(cloudProvider.id, cloudProviderId));
  if (row?.providerConfigId) return;
  const id = randomUUID();
  await db.insert(providerConfig).values({
    id,
    providerTypeId: type!.id,
    name: "Gitterm",
    encryptedCredentials: getEncryptionService().encryptForRecord(
      "{}",
      encryptionContext("provider-config", id, type!.id),
    ),
    isDefault: true,
  });
  await db
    .update(cloudProvider)
    .set({ providerConfigId: id })
    .where(eq(cloudProvider.id, cloudProviderId));
}

/** Prices are set in admin; until then a size can't start, which is easy to miss. */
async function warnUnpricedSizes(cloudProviderId: string): Promise<void> {
  const billing = await getBilling();
  if (!billing.enabled) return;
  const profiles = await db
    .select({ id: machineProfile.id, key: machineProfile.key })
    .from(machineProfile)
    .where(
      and(eq(machineProfile.cloudProviderId, cloudProviderId), eq(machineProfile.isEnabled, true)),
    );
  const prices = await billing.getMachinePrices(profiles.map((profile) => profile.id));
  const unpriced = profiles.filter((profile) => !prices.has(profile.id));
  if (unpriced.length)
    console.warn(
      `Gitterm sizes without a price can't start: ${unpriced.map((profile) => profile.key).join(", ")}. Set them in Admin → Providers → Gitterm.`,
    );
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
