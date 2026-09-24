import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { db, eq } from "@gitterm/db";
import {
  googleIssuerConfig,
  githubAppConfig,
  integrationSettings,
} from "@gitterm/db/schema/integrations";
import z from "zod";
import { adminProcedure, router } from "../..";
import { EncryptionService } from "../../service/encryption";
import { INTEGRATIONS, integrationCatalog } from "../../service/integrations/catalog";
import {
  isWorkloadIdentityAvailable,
  workloadIdentitySignerConfig,
} from "../../service/workload-identity/google";
import { GitHubAppService, isGitHubAppConfigured } from "../../service/github";

const key = z.enum(
  Object.keys(INTEGRATIONS) as [keyof typeof INTEGRATIONS, ...(keyof typeof INTEGRATIONS)[]],
);
const issuerSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    url.pathname === "/api/workload-identity"
  );
}, "Use a public HTTPS URL ending in /api/workload-identity");

export const adminIntegrationsRouter = router({
  list: adminProcedure.query(async () => {
    const [integrations, google, github] = await Promise.all([
      integrationCatalog(),
      db
        .select({
          issuer: googleIssuerConfig.issuer,
          keyId: googleIssuerConfig.keyId,
          updatedAt: googleIssuerConfig.updatedAt,
        })
        .from(googleIssuerConfig)
        .where(eq(googleIssuerConfig.id, "google")),
      db
        .select({
          appId: githubAppConfig.appId,
          slug: githubAppConfig.slug,
          updatedAt: githubAppConfig.updatedAt,
        })
        .from(githubAppConfig)
        .where(eq(githubAppConfig.id, "github")),
    ]);
    return {
      integrations,
      google: google[0] ?? null,
      github: github[0] ?? null,
      githubConfigured: !!github[0] || (await isGitHubAppConfigured()),
    };
  }),

  update: adminProcedure
    .input(
      z.object({
        key,
        enabled: z.boolean(),
        allowPersonal: z.boolean(),
        allowShared: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!INTEGRATIONS[input.key].ready && input.enabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This integration does not have a connector yet",
        });
      }
      if (
        (input.key === "google" || input.key === "github") &&
        (!input.allowPersonal || input.allowShared)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This connector currently supports personal connections only",
        });
      }
      if (input.enabled && input.key === "google" && !(await isWorkloadIdentityAvailable())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Configure the Google issuer before enabling Google Cloud",
        });
      }
      await db
        .insert(integrationSettings)
        .values({ ...input, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: integrationSettings.key,
          set: {
            enabled: input.enabled,
            allowPersonal: input.allowPersonal,
            allowShared: input.allowShared,
            updatedAt: new Date(),
          },
        });
      return { success: true };
    }),

  /** Generates the deployment's signing key on the server. Only the public identity is returned. */
  configureGoogle: adminProcedure
    .input(z.object({ issuer: issuerSchema, rotate: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const issuer = input.issuer.replace(/\/$/, "");
      const [previous] = await db
        .select()
        .from(googleIssuerConfig)
        .where(eq(googleIssuerConfig.id, "google"));
      if (previous && !input.rotate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Google issuer is already configured; explicitly rotate its key",
        });
      }
      if (previous?.previousKeyExpiresAt && previous.previousKeyExpiresAt > new Date()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Wait for the previous Google signing key's 15-minute overlap to expire before rotating again",
        });
      }
      let previousSigner;
      if (previous) {
        previousSigner = await workloadIdentitySignerConfig();
      } else {
        try {
          previousSigner = await workloadIdentitySignerConfig();
        } catch {
          /* first setup without legacy environment config */
        }
      }
      if (previousSigner && previousSigner.issuer !== issuer) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Issuer URL cannot change while Google connections may trust it",
        });
      }
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 3072,
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const keyId = `gitterm-google-${randomUUID()}`;
      const previousPublicKey = previousSigner
        ? {
            ...createPublicKey(createPrivateKey(previousSigner.privateKey)).export({
              format: "jwk",
            }),
            kid: previousSigner.keyId,
            use: "sig",
            alg: "RS256",
          }
        : null;
      const encryptedPrivateKey = new EncryptionService().encrypt(privateKey, "google:issuer:key");
      const previousKeyExpiresAt = previousPublicKey ? new Date(Date.now() + 15 * 60_000) : null;
      await db
        .insert(googleIssuerConfig)
        .values({
          id: "google",
          issuer,
          keyId,
          encryptedPrivateKey,
          previousPublicKey,
          previousKeyExpiresAt,
        })
        .onConflictDoUpdate({
          target: googleIssuerConfig.id,
          set: {
            issuer,
            keyId,
            encryptedPrivateKey,
            previousPublicKey,
            previousKeyExpiresAt,
            updatedAt: new Date(),
          },
        });
      return { issuer, keyId, rotated: !!previous };
    }),

  configureGithubApp: adminProcedure
    .input(
      z.object({
        appId: z.string().regex(/^[0-9]+$/),
        privateKey: z.string().min(100).max(20000),
        webhookSecret: z.string().min(16).max(1024),
      }),
    )
    .mutation(async ({ input }) => {
      // Verify the App ID and key against GitHub before making it available to users.
      let verified;
      try {
        verified = await new GitHubAppService({
          appId: input.appId,
          privateKey: input.privateKey,
        }).verifyApp();
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "GitHub could not verify the App ID and private key",
        });
      }
      if (verified.id !== input.appId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The key belongs to a different GitHub App",
        });
      }
      const encryption = new EncryptionService();
      await db
        .insert(githubAppConfig)
        .values({
          id: "github",
          appId: verified.id,
          slug: verified.slug,
          encryptedPrivateKey: encryption.encrypt(input.privateKey, "github:app:key"),
          encryptedWebhookSecret: encryption.encrypt(input.webhookSecret, "github:app:webhook"),
        })
        .onConflictDoUpdate({
          target: githubAppConfig.id,
          set: {
            appId: verified.id,
            slug: verified.slug,
            encryptedPrivateKey: encryption.encrypt(input.privateKey, "github:app:key"),
            encryptedWebhookSecret: encryption.encrypt(input.webhookSecret, "github:app:webhook"),
            updatedAt: new Date(),
          },
        });
      return { appId: verified.id, slug: verified.slug };
    }),
});
