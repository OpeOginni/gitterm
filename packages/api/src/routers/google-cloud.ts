import z from "zod";
import { TRPCError } from "@trpc/server";
import { and, db, eq } from "@gitterm/db";
import { googleCloudIntegration } from "@gitterm/db/schema/integrations";
import { accountProcedure, protectedProcedure, router } from "../index";
import {
  googleAudience,
  googlePrincipalSet,
  isWorkloadIdentityAvailable,
  workloadIdentityIssuer,
} from "../service/workload-identity/google";
import { integrationPolicy } from "../service/integrations/catalog";

const providerPattern =
  /^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[A-Za-z0-9_-]+\/providers\/[A-Za-z0-9_-]+$/;
const serviceAccountPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com$/;

const integrationInput = z.object({
  name: z.string().trim().min(1).max(100),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/),
  workloadIdentityProvider: z.string().trim().regex(providerPattern),
  serviceAccountEmail: z.string().trim().toLowerCase().regex(serviceAccountPattern),
});

async function publicIntegration(integration: typeof googleCloudIntegration.$inferSelect) {
  return {
    id: integration.id,
    name: integration.name,
    projectId: integration.projectId,
    workloadIdentityProvider: integration.workloadIdentityProvider,
    serviceAccountEmail: integration.serviceAccountEmail,
    active: integration.active,
    connectedAt: integration.connectedAt,
    updatedAt: integration.updatedAt,
    setup: {
      issuer: await workloadIdentityIssuer(),
      audience: googleAudience(integration.workloadIdentityProvider),
      attributeMapping: {
        "google.subject": "assertion.sub",
        "attribute.integration_id": "assertion.integration_id",
      },
      principalSet: googlePrincipalSet(integration),
    },
  };
}

export const googleCloudRouter = router({
  availability: accountProcedure("workspace:read").query(async () => {
    const available =
      (await integrationPolicy("google")).enabled && (await isWorkloadIdentityAvailable());
    // The issuer is deployment-wide and public (it is the OIDC discovery URL), so users can
    // create their Google provider before saving an identity.
    return { available, issuer: available ? await workloadIdentityIssuer() : null };
  }),

  list: accountProcedure("workspace:read").query(async ({ ctx }) => {
    if (!(await integrationPolicy("google")).enabled || !(await isWorkloadIdentityAvailable()))
      return [];

    const integrations = await db
      .select()
      .from(googleCloudIntegration)
      .where(
        and(
          eq(googleCloudIntegration.userId, ctx.session.user.id),
          eq(googleCloudIntegration.active, true),
        ),
      );
    return Promise.all(integrations.map(publicIntegration));
  }),

  create: protectedProcedure.input(integrationInput).mutation(async ({ input, ctx }) => {
    // Fail before writing a selectable integration when this deployment cannot issue assertions.
    if (!(await integrationPolicy("google")).enabled || !(await isWorkloadIdentityAvailable())) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Google Cloud is not enabled and configured by an admin",
      });
    }
    const [integration] = await db
      .insert(googleCloudIntegration)
      .values({ ...input, userId: ctx.session.user.id })
      .returning();
    if (!integration) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create Google Cloud integration",
      });
    }
    return publicIntegration(integration);
  }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [removed] = await db
        .delete(googleCloudIntegration)
        .where(
          and(
            eq(googleCloudIntegration.id, input.id),
            eq(googleCloudIntegration.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: googleCloudIntegration.id });
      if (!removed) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Google Cloud integration not found" });
      }
      return { success: true };
    }),
});
