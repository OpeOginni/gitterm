import z from "zod";
import { githubWebhookProcedure, router } from "../../index";
import { TRPCError } from "@trpc/server";
import { getInternalClient } from "../../client";
import { Webhooks } from "@octokit/webhooks";
import env from "@gitterm/env/server";

const webhooks = new Webhooks({
  secret: env.GITHUB_WEBHOOK_SECRET,
});

// GitHub installation webhook payload schema - only validate fields we need
// Use passthrough to allow additional fields GitHub sends
const githubInstallationAccountSchema = z
  .object({
    login: z.string(),
    id: z.number(),
    type: z.string(),
  })
  .loose();

const githubInstallationSchema = z
  .object({
    id: z.number(),
    account: githubInstallationAccountSchema,
  })
  .loose();

const githubWebhookPayloadSchema = z
  .object({
    action: z.string(),
    installation: githubInstallationSchema,
  })
  .loose();

// Actions we handle
const HANDLED_ACTIONS = ["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"];

export const githubWebhookRouter = router({
  /**
   * Handle GitHub App installation webhooks
   * Called by listener when it receives a webhook from GitHub
   */
  handleInstallationWebhook: githubWebhookProcedure
    .input(githubWebhookPayloadSchema)
    .mutation(async ({ input, ctx }) => {
      const verified = await webhooks.verify(ctx.githubRawBody, ctx.githubXHubSignature256!);

      if (!verified) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "GitHub X-Hub-Signature-256 verification failed",
        });
      }

      // Only handle installation events
      if (ctx.githubEvent !== "installation") {
        return { success: true, message: "Event ignored", action: null };
      }

      // Check if this is an action we handle
      if (!HANDLED_ACTIONS.includes(input.action)) {
        return { success: true, message: "Action ignored", action: input.action };
      }

      try {
        const client = getInternalClient();

        const result = await client.internal.processGitHubInstallationWebhook.mutate({
          action: input.action as
            | "created"
            | "deleted"
            | "suspend"
            | "unsuspend"
            | "new_permissions_accepted",
          installationId: String(input.installation.id),
          accountLogin: input.installation.account.login,
          accountId: String(input.installation.account.id),
          accountType: input.installation.account.type,
        });

        return {
          success: true,
          message: `Processed installation.${input.action}`,
          action: input.action,
          result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;

        console.error("[GitHub Webhook] Failed to process webhook:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process webhook",
          cause: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
});

export type GitHubWebhookRouter = typeof githubWebhookRouter;
