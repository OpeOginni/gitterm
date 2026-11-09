/**
 * gitterm.dev only: registers Gitterm Compute as a provider with its sizes (small, medium) and
 * marks the images Compute can run. Not part of the seed, so self-hosted deployments never
 * get it. Safe to rerun, e.g. after Compute gains an image.
 */
import { db, eq } from "@gitterm/db";
import { cloudProvider, image, machineProfile } from "@gitterm/db/schema/cloud";
import { ensureComputeProvider } from "../service/compute-provider";

try {
  await ensureComputeProvider();
  const [provider] = await db
    .select({ id: cloudProvider.id, isEnabled: cloudProvider.isEnabled })
    .from(cloudProvider)
    .where(eq(cloudProvider.name, "Gitterm"));
  const sizes = await db
    .select({
      key: machineProfile.key,
      isEnabled: machineProfile.isEnabled,
      isDefault: machineProfile.isDefault,
    })
    .from(machineProfile)
    .where(eq(machineProfile.cloudProviderId, provider!.id));
  const images = (await db.select({ name: image.name, meta: image.providerMetadata }).from(image))
    .filter((row) => row.meta?.gitterm)
    .map((row) => row.name);
  console.log(`Gitterm provider ${provider!.isEnabled ? "enabled" : "disabled by an admin"}.`);
  for (const size of sizes)
    console.log(
      `  size ${size.key}: ${size.isEnabled ? "enabled" : "disabled"}${size.isDefault ? " (default)" : ""}`,
    );
  console.log(`  images: ${images.join(", ") || "none"}`);
  process.exit(0);
} catch (error) {
  console.error("Gitterm Compute setup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
