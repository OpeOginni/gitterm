import z from "zod";
import { protectedProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { db, eq, and } from "@gitterm/db";
import { cloudProvider } from "@gitterm/db/schema/cloud";
import { cloudSession } from "@gitterm/db/schema/cloud-sessions";
import { githubAppInstallation, gitIntegration } from "@gitterm/db/schema/integrations";
import { getGitHubAppService } from "../github";
import env from "@gitterm/env/server";
import { getModelCredentialsService } from "../model-credentials";
import { modelProvider } from "@gitterm/db/schema/model-credentials";
import type { CloudSessionDestroyConfig, CloudSessionSpawnConfig, SandboxCredential } from "../../providers";

export const cloudSessionCreateSchema = z.object({
  sandboxProviderId: z.uuid(),
  remoteRepoOwner: z.string(),
  remoteRepoName: z.string(),
  remoteBranch: z.string(),
  baseCommitSha: z.string(),
  providerId: z.uuid(),
});

export const cloudSessionSpawnSchema = z.object({
  opencodeSessionId: z.string(),
});

export const cloudSessionDestroySchema = z.object({
  opencodeSessionId: z.string(),
});

export const cloudSessionRouter = router({
  create: protectedProcedure.input(cloudSessionCreateSchema).mutation(async ({ input, ctx }) => {
    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
    }

    const [sandboxProvider] = await db
      .select()
      .from(cloudProvider)
      .where(eq(cloudProvider.id, input.sandboxProviderId));

    if (!sandboxProvider || sandboxProvider.isSandbox !== true) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox provider not found" });
    }

    const userGitIntegrations = await db
      .select()
      .from(gitIntegration)
      .where(eq(gitIntegration.userId, userId));
    const userGithubIntegration = userGitIntegrations[0];

    if (!userGithubIntegration) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Setup Github Integration" });
    }

    const [githubInstallation] = await db
      .select()
      .from(githubAppInstallation)
      .where(eq(githubAppInstallation.installationId, userGithubIntegration.providerInstallationId));

    const githubService = getGitHubAppService();

    if (!githubInstallation || githubInstallation.suspended) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "GitHub installation not found or suspended",
      });
    }

    const [modelProviderData] = await db
      .select()
      .from(modelProvider)
      .where(eq(modelProvider.id, input.providerId));

    if (!modelProviderData) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Model provider not found" });
    }

    const tokenData = await githubService.getUserToServerToken(githubInstallation.installationId, [
      input.remoteRepoName,
    ]);

    const credService = getModelCredentialsService();
    const decryptedCred = await credService.getUserCredentialForProvider(
      userId,
      modelProviderData.name,
    );

    if (!decryptedCred) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Make sure you have set a ${modelProviderData.displayName} Provider Credential`,
      });
    }

    const credential = (await credService.getCredentialForRun(
      decryptedCred.id,
      userId,
    )) as SandboxCredential;

    const [createdSession] = await db
      .insert(cloudSession)
      .values({
        userId,
        sandboxProviderId: input.sandboxProviderId,
        modelProviderId: modelProviderData.id,
        remoteRepoOwner: input.remoteRepoOwner,
        remoteRepoName: input.remoteRepoName,
        remoteBranch: input.remoteBranch,
        baseCommitSha: input.baseCommitSha,
      })
      .returning();

    if (!createdSession) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create session" });
    }

    const requestBody: CloudSessionSpawnConfig = {
      gittermCloudSessionId: createdSession.id,
      baseCommitSha: input.baseCommitSha,
      repoOwner: input.remoteRepoOwner,
      repoName: input.remoteRepoName,
      branch: input.remoteBranch,
      gitAuthToken: tokenData.token,
      providerName: modelProviderData.name,
      credential,
    };

    const SPAWN_CLOUD_SESSION_WORKER_URL = "https://cloud-session-worker.mock/spawn";

    const response = await fetch(SPAWN_CLOUD_SESSION_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to spawn cloud session",
      });
    }

    const responseBody = (await response.json()) as {
      success: boolean;
      error?: string;
      result?: { sessionId?: string; exposedServerUrl?: string };
    };

    if (!responseBody.success || !responseBody.result?.exposedServerUrl) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: responseBody.error ?? "Cloud session worker failed",
      });
    }

    await db
      .update(cloudSession)
      .set({
        sandboxId: createdSession.id,
        opencodeSessionId: responseBody.result.sessionId ?? null,
        serverUrl: responseBody.result.exposedServerUrl,
        updatedAt: new Date(),
      })
      .where(eq(cloudSession.id, createdSession.id));

    return {
      cloudSessionId: createdSession.id,
      serverUrl: responseBody.result.exposedServerUrl,
      sessionId: responseBody.result.sessionId ?? null,
    };
  }),

  spawn: protectedProcedure.input(cloudSessionSpawnSchema).mutation(async ({ input, ctx }) => {
    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
    }

    const [existingSession] = await db
      .select()
      .from(cloudSession)
      .where(
        and(
          eq(cloudSession.opencodeSessionId, input.opencodeSessionId),
          eq(cloudSession.userId, userId),
        ),
      );

    if (!existingSession) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cloud session not found" });
    }

    const userGitIntegrations = await db
      .select()
      .from(gitIntegration)
      .where(eq(gitIntegration.userId, userId));
    const userGithubIntegration = userGitIntegrations[0];

    if (!userGithubIntegration) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Setup Github Integration" });
    }

    const [githubInstallation] = await db
      .select()
      .from(githubAppInstallation)
      .where(eq(githubAppInstallation.installationId, userGithubIntegration.providerInstallationId));

    const githubService = getGitHubAppService();

    if (!githubInstallation || githubInstallation.suspended) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "GitHub installation not found or suspended",
      });
    }

    const [modelProviderData] = await db
      .select()
      .from(modelProvider)
      .where(eq(modelProvider.id, existingSession.modelProviderId));

    if (!modelProviderData) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Model provider not found" });
    }

    const tokenData = await githubService.getUserToServerToken(githubInstallation.installationId, [
      existingSession.remoteRepoName,
    ]);

    const credService = getModelCredentialsService();
    const decryptedCred = await credService.getUserCredentialForProvider(
      userId,
      modelProviderData.name,
    );

    if (!decryptedCred) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Make sure you have set a ${modelProviderData.displayName} Provider Credential`,
      });
    }

    const credential = (await credService.getCredentialForRun(
      decryptedCred.id,
      userId,
    )) as SandboxCredential;

    const requestBody: CloudSessionSpawnConfig = {
      gittermCloudSessionId: existingSession.id,
      baseCommitSha: existingSession.baseCommitSha,
      repoOwner: existingSession.remoteRepoOwner,
      repoName: existingSession.remoteRepoName,
      branch: existingSession.remoteBranch,
      gitAuthToken: tokenData.token,
      providerName: modelProviderData.name,
      credential,
    };

    const SPAWN_CLOUD_SESSION_WORKER_URL = "https://cloud-session-worker.mock/spawn";

    const response = await fetch(SPAWN_CLOUD_SESSION_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to spawn cloud session",
      });
    }

    const responseBody = (await response.json()) as {
      success: boolean;
      error?: string;
      result?: { sessionId?: string; exposedServerUrl?: string };
    };

    if (!responseBody.success || !responseBody.result?.exposedServerUrl) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: responseBody.error ?? "Cloud session worker failed",
      });
    }

    await db
      .update(cloudSession)
      .set({
        sandboxId: existingSession.id,
        opencodeSessionId: responseBody.result.sessionId ?? existingSession.opencodeSessionId,
        serverUrl: responseBody.result.exposedServerUrl,
        updatedAt: new Date(),
      })
      .where(eq(cloudSession.id, existingSession.id));

    return {
      cloudSessionId: existingSession.id,
      serverUrl: responseBody.result.exposedServerUrl,
      sessionId: responseBody.result.sessionId ?? null,
    };
  }),

  destroy: protectedProcedure.input(cloudSessionDestroySchema).mutation(async ({ input, ctx }) => {
    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
    }

    const [existingSession] = await db
      .select()
      .from(cloudSession)
      .where(
        and(
          eq(cloudSession.opencodeSessionId, input.opencodeSessionId),
          eq(cloudSession.userId, userId),
        ),
      );

    if (!existingSession) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cloud session not found" });
    }

    const requestBody: CloudSessionDestroyConfig = {
      gittermCloudSessionId: existingSession.id,
    };

    const DESTROY_CLOUD_SESSION_WORKER_URL = "https://cloud-session-worker.mock/destroy";

    const response = await fetch(DESTROY_CLOUD_SESSION_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to destroy cloud session",
      });
    }

    await db
      .update(cloudSession)
      .set({
        opencodeSessionId: null,
        serverUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(cloudSession.id, existingSession.id));

    return { success: true };
  }),
});
