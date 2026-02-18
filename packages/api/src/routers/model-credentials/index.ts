/**
 * Model Credentials Router
 *
 * tRPC routes for managing model provider credentials (API keys and OAuth tokens).
 */

import z from "zod";
import { protectedProcedure, publicProcedure, router } from "../..";
import { TRPCError } from "@trpc/server";
import { getModelCredentialsService } from "../../service/credentials/model-credentials";
import { GitHubCopilotOAuthService } from "../../service/credentials/oauth/github-copilot";

const credentialsService = getModelCredentialsService();

export const modelCredentialsRouter = router({
  // ==================== Provider & Model Queries ====================

  /**
   * List all enabled model providers
   */
  listProviders: publicProcedure.query(async () => {
    const providers = await credentialsService.listProviders();
    return {
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        authType: p.authType,
        plugin: p.plugin,
        hasOAuthConfig: !!p.oauthConfig,
        isRecommended: p.isRecommended,
      })),
    };
  }),

  /**
   * List all enabled models (with provider info)
   */
  listModels: publicProcedure.query(async () => {
    const models = await credentialsService.listAllModels();
    return {
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        modelId: m.modelId,
        isFree: m.isFree,
        isRecommended: m.isRecommended,
        provider: {
          id: m.provider.id,
          name: m.provider.name,
          displayName: m.provider.displayName,
        },
      })),
    };
  }),

  /**
   * List models for a specific provider
   */
  listModelsForProvider: publicProcedure
    .input(z.object({ providerId: z.string().uuid() }))
    .query(async ({ input }) => {
      const models = await credentialsService.listModelsForProvider(input.providerId);
      return {
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          displayName: m.displayName,
          modelId: m.modelId,
          isFree: m.isFree,
        })),
      };
    }),

  // ==================== Credential Management ====================

  /**
   * List user's stored credentials (metadata only, no secrets)
   */
  listMyCredentials: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
    }

    const credentials = await credentialsService.listUserCredentials(userId);
    return { credentials };
  }),

  /**
   * Store an API key credential
   */
  storeApiKey: protectedProcedure
    .input(
      z.object({
        providerName: z.string().min(1),
        apiKey: z.string().min(1),
        label: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      try {
        const result = await credentialsService.storeApiKey({
          userId,
          providerName: input.providerName,
          apiKey: input.apiKey,
          label: input.label,
        });

        return {
          success: true,
          credentialId: result.id,
          keyHash: result.keyHash,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to store API key",
        });
      }
    }),

  /**
   * Store OAuth tokens (manual paste from OpenCode auth.json)
   */
  storeOAuthTokens: protectedProcedure
    .input(
      z.object({
        providerName: z.string().min(1),
        refreshToken: z.string().min(1),
        accessToken: z.string().optional(),
        expiresAt: z.number().optional(),
        enterpriseUrl: z.string().optional(),
        label: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      try {
        const result = await credentialsService.storeOAuthTokens({
          userId,
          providerName: input.providerName,
          refreshToken: input.refreshToken,
          accessToken: input.accessToken,
          expiresAt: input.expiresAt,
          enterpriseUrl: input.enterpriseUrl,
          label: input.label,
        });

        return {
          success: true,
          credentialId: result.id,
          keyHash: result.keyHash,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to store OAuth tokens",
        });
      }
    }),

  /**
   * Revoke (soft delete) a credential
   */
  revokeCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      try {
        await credentialsService.revokeCredential(input.credentialId, userId);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error instanceof Error ? error.message : "Credential not found",
        });
      }
    }),

  /**
   * Permanently delete a credential
   */
  deleteCredential: protectedProcedure
    .input(z.object({ credentialId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      try {
        await credentialsService.deleteCredential(input.credentialId, userId);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error instanceof Error ? error.message : "Credential not found",
        });
      }
    }),

  /**
   * Rotate an API key
   */
  rotateApiKey: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().uuid(),
        newApiKey: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      try {
        await credentialsService.rotateApiKey(input.credentialId, userId, input.newApiKey);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to rotate API key",
        });
      }
    }),

  // ==================== OAuth Device Code Flow (GitHub Copilot) ====================

  /**
   * Initiate OAuth device code flow
   */
  initiateOAuth: protectedProcedure
    .input(
      z.object({
        providerName: z.string().min(1),
        enterpriseUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      // Check if the provider exists and supports OAuth
      const provider = await credentialsService.getProviderByName(input.providerName);
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Provider not found: ${input.providerName}`,
        });
      }

      if (provider.authType !== "oauth") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Provider ${input.providerName} does not support OAuth authentication`,
        });
      }

      try {
        // Use the provider's plugin to determine which OAuth service to use
        if (provider.plugin === "copilot-auth") {
          const deviceCode = await GitHubCopilotOAuthService.initiateDeviceCode(
            input.enterpriseUrl,
          );

          return {
            success: true,
            flowType: "device_code" as const,
            verificationUri: deviceCode.verificationUri,
            userCode: deviceCode.userCode,
            deviceCode: deviceCode.deviceCode,
            interval: deviceCode.interval,
            expiresIn: deviceCode.expiresIn,
          };
        }

        // For codex-auth, we don't support OAuth flow - users should paste auth.json tokens
        if (provider.plugin === "codex-auth") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "OpenAI Codex requires manual token paste from OpenCode CLI auth.json. Please use the 'Paste auth.json' option.",
          });
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `OAuth plugin not implemented for provider: ${input.providerName}`,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to initiate OAuth flow",
        });
      }
    }),

  /**
   * Poll for OAuth token (single poll, client should call repeatedly)
   * Used for device code flow (GitHub Copilot)
   */
  pollOAuth: protectedProcedure
    .input(
      z.object({
        providerName: z.string().min(1),
        deviceCode: z.string().min(1),
        enterpriseUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      // Check if the provider exists and supports OAuth
      const provider = await credentialsService.getProviderByName(input.providerName);
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Provider not found: ${input.providerName}`,
        });
      }

      if (provider.authType !== "oauth") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Provider ${input.providerName} does not support OAuth authentication`,
        });
      }

      try {
        // Use the provider's plugin to determine which OAuth service to use
        if (provider.plugin === "copilot-auth") {
          const result = await GitHubCopilotOAuthService.pollForToken(
            input.deviceCode,
            input.enterpriseUrl,
          );

          if (result.success && result.accessToken) {
            return {
              status: "success" as const,
              accessToken: result.accessToken,
            };
          }

          if (result.error === "authorization_pending") {
            return { status: "pending" as const };
          }

          if (result.error === "slow_down") {
            return { status: "slow_down" as const };
          }

          return {
            status: "failed" as const,
            error: result.error,
          };
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `OAuth plugin not implemented for provider: ${input.providerName}`,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to poll OAuth",
        });
      }
    }),

  /**
   * Complete OAuth flow - store the token after successful authorization
   */
  completeOAuth: protectedProcedure
    .input(
      z.object({
        providerName: z.string().min(1),
        accessToken: z.string().min(1), // This is the OAuth token (stored as refresh for Copilot)
        enterpriseUrl: z.string().optional(),
        label: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      // Check if the provider exists and supports OAuth
      const provider = await credentialsService.getProviderByName(input.providerName);
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Provider not found: ${input.providerName}`,
        });
      }

      if (provider.authType !== "oauth") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Provider ${input.providerName} does not support OAuth authentication`,
        });
      }

      try {
        // The accessToken from OAuth is stored as a "refresh" token
        // For GitHub Copilot, we use it to get short-lived Copilot API tokens
        const result = await credentialsService.storeOAuthTokens({
          userId,
          providerName: input.providerName,
          refreshToken: input.accessToken,
          enterpriseUrl: input.enterpriseUrl,
          label: input.label,
        });

        return {
          success: true,
          credentialId: result.id,
          keyHash: result.keyHash,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to complete OAuth",
        });
      }
    }),

  // ==================== Credential Usage ====================

  /**
   * Check if user has a valid credential for a provider
   */
  hasCredentialForProvider: protectedProcedure
    .input(z.object({ providerName: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User not authenticated" });
      }

      const credential = await credentialsService.getUserCredentialForProvider(
        userId,
        input.providerName,
      );

      return {
        hasCredential: !!credential,
        credentialId: credential?.id,
      };
    }),
});
