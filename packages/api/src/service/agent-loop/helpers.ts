import { db, eq } from "@gitterm/db";
import { modelProvider, model } from "@gitterm/db/schema/model-credentials";
import { TRPCError } from "@trpc/server";
import type { SandboxCredential } from "../../providers/compute";
import { getModelCredentialsService } from "../credentials/model-credentials";

/**
 * Get model provider and model records from loop
 */
export async function getModelConfig(loop: { modelProviderId: string; modelId: string }) {
  const [providerRecord] = await db
    .select()
    .from(modelProvider)
    .where(eq(modelProvider.id, loop.modelProviderId));

  const [modelRecord] = await db.select().from(model).where(eq(model.id, loop.modelId));

  if (!providerRecord || !modelRecord) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Model provider or model not found",
    });
  }

  return { providerRecord, modelRecord };
}

/**
 * Get credential for a run
 * Handles both manual runs (finds user's credential) and automated runs (uses loop's credentialId)
 */
export async function getCredentialForRun(
  userId: string,
  loopId: string,
  runId: string,
  loop: { modelProviderId: string; modelId: string; credentialId?: string | null },
  providerRecord: { name: string; displayName: string },
  modelRecord: { isFree: boolean },
): Promise<SandboxCredential> {
  const credService = getModelCredentialsService();

  let credential: SandboxCredential = {
    type: "api_key",
    apiKey: "", // Default empty for free models
  };

  // Check if model is free (no credential needed)
  if (!modelRecord.isFree) {
    if (loop.credentialId) {
      // Automated run - use loop's stored credential
      // getCredentialForRun already returns CredentialForRun (SandboxCredential format)
      credential = await credService.getCredentialForRun(loop.credentialId, userId, {
        loopId,
        runId,
      });
    } else {
      // Manual run - find user's credential for provider
      // getUserCredentialForProvider returns DecryptedCredential (has .credential property)
      const decryptedCred = await credService.getUserCredentialForProvider(
        userId,
        providerRecord.name,
      );

      if (!decryptedCred) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No API key configured for ${providerRecord.displayName}. Please add one in Settings > Integrations.`,
        });
      }

      // Convert DecryptedCredential to SandboxCredential format
      if (decryptedCred.credential.type === "api_key") {
        credential = {
          type: "api_key",
          apiKey: decryptedCred.credential.apiKey,
        };
      } else {
        // OAuth - ensure we have fresh tokens by calling getCredentialForRun
        // This converts DecryptedCredential to CredentialForRun (SandboxCredential)
        credential = await credService.getCredentialForRun(decryptedCred.id, userId, {
          loopId,
          runId,
        });
      }
    }
  }

  return credential;
}
