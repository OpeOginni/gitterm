import { randomBytes, randomUUID } from "crypto";
import z from "zod";
import { TRPCError } from "@trpc/server";
import { db, eq, and } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import { agentType, cloudProvider, image } from "@gitterm/db/schema/cloud";
import env, { isAnonTryEnabled } from "@gitterm/env/server";
import { AnonTryRepository } from "@gitterm/redis";

import { publicProcedure, router } from "../../index";
import { e2bProvider } from "../../providers";
import type { WorkspaceEnvironmentVariables } from "../../providers";
import { workspaceJWT } from "../../service/auth/workspace-jwt";
import {
  checkPublicGitHubRepository,
  parseGitHubRepoUrl,
} from "../../service/github";
import { getWorkspaceDomain } from "../../utils/routing";
import { buildWorkspaceToolingManifestBase64 } from "../../utils/workspace-tooling";
import {
  deleteWorkspaceRouteAccess,
  upsertWorkspaceRouteAccess,
} from "../../service/workspace-route-access";
import {
  invalidateWorkspaceCacheAfterMutation,
  updateWorkspaceByIdReturningAndInvalidate,
} from "../../service/workspace-mutations";
import { logger } from "../../utils/logger";
import {
  hashClientIp,
  getOrCreateAnonUser,
} from "../../service/anon/anon-user";
import {
  ANON_TOKEN_TTL_SECONDS,
  buildAnonCookieClearHeader,
  buildAnonCookieHeader,
  readAnonCookie,
  signAnonAccessToken,
  verifyAnonAccessToken,
} from "../../service/anon/anon-access-token";

/**
 * Anonymous "try gitterm" router.
 *
 * Lets a logged-out homepage visitor spin up a 10-minute E2B sandbox running
 * OpenCode against a public GitHub repo. Rate-limited to 1 launch per IP per
 * 24h via Redis.
 *
 * Sandbox lifecycle (10-min wall clock + hard kill) is enforced by E2B
 * itself — see `providers/e2b/index.ts`. The existing E2B webhook handler
 * flips workspace status to `terminated` automatically. The idle reaper
 * (`apps/worker/src/idle-reaper.ts`) is the safety net for missed webhooks.
 *
 * Workspace access is gated by an HMAC-signed cookie scoped to the workspace
 * subdomain (see `service/anon/anon-access-token.ts`). The proxy resolver
 * accepts that cookie in lieu of a session.
 */

/* ─── Agent variants ──────────────────────────────────────────────────── */

// The anon flow only exposes the OpenCode Server / App surface. Browser TUI
// (terminal) is not supported because E2B does not have a template for it.
type AnonAgentVariant = "app";

const ANON_AGENT_CHOICES: Record<
  AnonAgentVariant,
  { agentTypeName: string; imageName: string; serverOnly: boolean }
> = {
  // OpenCode's desktop UI served at the workspace root over HTTP.
  app: {
    agentTypeName: "OpenCode Server",
    imageName: "gitterm-opencode-server",
    serverOnly: true,
  },
};

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function normalizeRepoUrl(input: string): string | null {
  const trimmed = input.trim();
  const shorthand = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/i;
  if (shorthand.test(trimmed)) {
    return `https://github.com/${trimmed}`.replace(/\.git$/i, "");
  }
  const parsed = parseGitHubRepoUrl(trimmed);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

const RESERVED = new Set([
  "api",
  "www",
  "app",
  "admin",
  "dashboard",
  "cdn",
  "static",
  "assets",
  "mail",
  "email",
  "ftp",
  "ssh",
  "docs",
  "blog",
  "status",
  "support",
]);

async function generateUniqueSubdomain(): Promise<string> {
  for (let attempts = 0; attempts < 10; attempts++) {
    const candidate = randomUUID().split("-")[0]!;
    if (RESERVED.has(candidate)) continue;
    const [taken] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.subdomain, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to generate a unique workspace subdomain.",
  });
}

function isAnonTryReady(): boolean {
  return isAnonTryEnabled() && Boolean(env.BETTER_AUTH_SECRET);
}

/* ─── Router ──────────────────────────────────────────────────────────── */

export const anonRouter = router({
  /**
   * Surface whether the homepage anon flow is wired up. The frontend uses
   * this to render the form vs a "coming soon" hint.
   */
  status: publicProcedure.query(() => ({
    enabled: isAnonTryReady(),
    sessionMinutes: 10,
    sandboxProvider: "e2b" as const,
  })),

  tryGitterm: publicProcedure
    .input(
      z.object({
        repo: z.string().min(3).max(300),
        // The anon flow only supports the OpenCode Server / App surface.
        agent: z.literal("app").default("app"),
        // Optional branch — defaults to repo's default branch
        branch: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[A-Za-z0-9._/-]+$/)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isAnonTryReady()) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "This feature is not available right now.",
        });
      }

      const rawIp = ctx.clientIp;
      if (!rawIp) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not determine your IP address. Please try again.",
        });
      }
      const ipHash = hashClientIp(rawIp);

      const repoUrl = normalizeRepoUrl(input.repo);
      if (!repoUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Paste a public GitHub repo URL or owner/name (e.g. vercel/next.js).",
        });
      }

      const variant = ANON_AGENT_CHOICES[input.agent];

      // ── 1. Rate-limit (atomic SET NX EX) ──────────────────────────────
      const anonRepo = new AnonTryRepository();
      const slot = await anonRepo.consumeSlot(ipHash);
      if (!slot.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "You've used your trial workspace. Sign in for unlimited workspaces.",
        });
      }

      try {
        // ── 2. Validate repo is public + exists ─────────────────────────
        try {
          const validation = await checkPublicGitHubRepository(
            repoUrl,
            input.branch,
          );
          if (!validation.valid) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Invalid repository URL.",
            });
          }
          if (!validation.exists) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Repo not found or is private. Anonymous launches only support public repos.",
            });
          }
          if (!validation.canClone) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Repo cannot be cloned.",
            });
          }
          if (input.branch && !validation.branchExists) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Branch "${input.branch}" not found in this repository.`,
            });
          }
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Could not validate the repository. Make sure it's a public GitHub repo.",
          });
        }

        // ── 3. Resolve the synthetic anon user ──────────────────────────
        const anonUser = await getOrCreateAnonUser(ipHash);

        // ── 4. Resolve E2B provider + chosen agent + image ──────────────
        const [providerRecord] = await db
          .select()
          .from(cloudProvider)
          .where(
            and(
              eq(cloudProvider.providerKey, "e2b"),
              eq(cloudProvider.isEnabled, true),
            ),
          )
          .limit(1);
        if (!providerRecord) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message:
              "E2B is not configured. Anonymous sandboxes are temporarily offline.",
          });
        }

        const [agentRecord] = await db
          .select()
          .from(agentType)
          .where(
            and(
              eq(agentType.name, variant.agentTypeName),
              eq(agentType.isEnabled, true),
            ),
          )
          .limit(1);
        if (!agentRecord) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: `${variant.agentTypeName} agent is not available.`,
          });
        }
        if (agentRecord.serverOnly !== variant.serverOnly) {
          // Defensive: the seed and our mapping should always agree
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Agent configuration mismatch.",
          });
        }

        const [imageRecord] = await db
          .select()
          .from(image)
          .where(
            and(
              eq(image.agentTypeId, agentRecord.id),
              eq(image.name, variant.imageName),
              eq(image.isEnabled, true),
            ),
          )
          .limit(1);
        if (!imageRecord) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: `${variant.imageName} image is not available.`,
          });
        }

        // ── 5. Generate workspace identity ───────────────────────────────
        const workspaceId = randomUUID();
        const subdomain = await generateUniqueSubdomain();
        const domain = getWorkspaceDomain(subdomain);

        const workspaceAuthToken = workspaceJWT.generateToken(
          workspaceId,
          anonUser.id,
          ["port:*"],
        );

        // ── 6. Build env vars ────────────────────────────────────────────
        // OpenCode ships with built-in free models, so we don't inject any
        // model credentials. We DO mint a basic-auth password so the visitor
        // can connect from the OpenCode desktop app or CLI (those clients
        // can't carry our cookie). Plaintext storage is fine here: the row
        // is gone in 10 minutes regardless.
        const serverUsername = "opencode";
        const serverPassword = randomBytes(16).toString("hex");

        const opencodeConfig = {
          $schema: "https://opencode.ai/config.json",
          username: `Gitterm Try · ${ipHash.slice(0, 6)}`,
        };

        const WORKSPACE_API_URL =
          process.env.WORKSPACE_API_URL ||
          process.env.INTERNAL_API_URL ||
          "https://api.gitterm.dev/trpc";

        const repoInfo = parseGitHubRepoUrl(repoUrl);
        const toolingManifestBase64 = await buildWorkspaceToolingManifestBase64(
          {
            owner: repoInfo?.owner,
            repo: repoInfo?.repo,
          },
        );

        const envVars: WorkspaceEnvironmentVariables = {
          REPO_URL: repoUrl,
          REPO_BRANCH: input.branch || undefined,
          OPENCODE_CONFIG_BASE64: Buffer.from(
            JSON.stringify(opencodeConfig),
          ).toString("base64"),
          OPENCODE_CREDENTIALS_BASE64: Buffer.from(JSON.stringify({})).toString(
            "base64",
          ),
          OPENCODE_SERVER_PASSWORD: serverPassword,
          WORKSPACE_TOOLING_MANIFEST_BASE64: toolingManifestBase64,
          REPO_OWNER: repoInfo?.owner,
          REPO_NAME: repoInfo?.repo,
          WORKSPACE_ID: workspaceId,
          WORKSPACE_AUTH_TOKEN: workspaceAuthToken,
          WORKSPACE_API_URL,
          WORKSPACE_PROFILE: "standard",
          EDITOR_ACCESS_ENABLED: "false",
        };

        // ── 7. Spawn ephemeral sandbox (kill-on-timeout) ─────────────────
        const workspaceInfo = await e2bProvider.createEphemeralAnonWorkspace({
          workspaceId,
          userId: anonUser.id,
          imageId: imageRecord.imageId,
          imageProviderMetadata: imageRecord.providerMetadata,
          subdomain,
          repositoryUrl: repoUrl,
          repositoryBranch: input.branch,
          regionIdentifier: undefined,
          environmentVariables: envVars,
        });

        // ── 8. Persist workspace row ─────────────────────────────────────
        const startedAt = new Date(workspaceInfo.serviceCreatedAt);
        const [newWorkspace] = await db
          .insert(workspace)
          .values({
            id: workspaceId,
            externalInstanceId: workspaceInfo.externalServiceId,
            userId: anonUser.id,
            imageId: imageRecord.id,
            cloudProviderId: providerRecord.id,
            gitIntegrationId: null,
            persistent: false,
            repositoryUrl: repoUrl,
            repositoryBranch: input.branch ?? null,
            domain,
            subdomain,
            serverOnly: variant.serverOnly,
            workspaceProfile: "standard",
            editorAccessEnabled: false,
            editorTarget: null,
            sshConnection: null,
            // Plaintext: row is ephemeral (10 min) and the password is also
            // returned to the client in the same response.
            serverPassword,
            upstreamUrl: workspaceInfo.upstreamUrl,
            status: "running",
            hostingType: "cloud",
            name: `try-${subdomain}`,
            startedAt,
            lastActiveAt: startedAt,
            updatedAt: startedAt,
          })
          .returning();

        if (!newWorkspace) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to record workspace.",
          });
        }

        if (workspaceInfo.upstreamAccess?.headers) {
          await upsertWorkspaceRouteAccess(
            workspaceId,
            null,
            workspaceInfo.upstreamAccess.headers,
          );
        }
        await invalidateWorkspaceCacheAfterMutation(workspaceId, subdomain);

        // ── 9. Mint and set anon access cookie ───────────────────────────
        const signed = signAnonAccessToken({ subdomain, workspaceId });
        const cookieHeader = buildAnonCookieHeader({
          token: signed.token,
          ttlSeconds: ANON_TOKEN_TTL_SECONDS,
        });
        // Hono's `header()` appends rather than replaces, so this is safe to
        // call alongside any cookies set elsewhere in the response.
        ctx.honoContext.header("Set-Cookie", cookieHeader, { append: true });

        const expiresAtMs = signed.expiresAt.getTime();

        logger.info(
          `[anon-try] sandbox booted workspace=${workspaceId} agent=${input.agent} ipHash=${ipHash.slice(
            0,
            8,
          )} repo=${repoUrl}`,
        );

        return {
          workspaceId,
          userId: anonUser.id,
          subdomain,
          agent: input.agent,
          serverUsername,
          serverPassword,
          startedAt: startedAt.toISOString(),
          expiresAt: new Date(expiresAtMs).toISOString(),
          expiresInSeconds: ANON_TOKEN_TTL_SECONDS,
        };
      } catch (err) {
        // Refund the rate-limit slot on internal failures so the user isn't
        // locked out for 24h because of an upstream error.
        if (
          !(err instanceof TRPCError) ||
          err.code === "INTERNAL_SERVER_ERROR" ||
          err.code === "SERVICE_UNAVAILABLE"
        ) {
          await anonRepo.releaseSlot(ipHash).catch(() => undefined);
        }
        if (!(err instanceof TRPCError)) {
          logger.error(
            `[anon-try] launch failed: ${(err as Error)?.message ?? err}`,
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to launch sandbox. Please try again in a moment.",
          });
        }
        throw err;
      }
    }),

  killAnonWorkspace: publicProcedure
    .input(z.object({ workspaceId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!isAnonTryReady()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This feature is not available right now.",
        });
      }

      // Look up the workspace and verify the browser still has the signed,
      // workspace-bound anon cookie. IP ownership is not enough behind NATs.
      const fetchedWorkspace = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId))
        .limit(1);

      const ws = fetchedWorkspace[0];
      if (!ws?.subdomain) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found.",
        });
      }

      const anonCookieRaw = readAnonCookie(
        ctx.honoContext.req.header("Cookie"),
      );
      const verified = anonCookieRaw
        ? verifyAnonAccessToken(anonCookieRaw, ws.subdomain)
        : null;
      if (!verified || verified.workspaceId !== ws.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found.",
        });
      }

      // Already dead — nothing to do
      if (ws.status === "terminated") {
        ctx.honoContext.header("Set-Cookie", buildAnonCookieClearHeader(), {
          append: true,
        });
        return { success: true };
      }

      // Terminate via E2B
      try {
        await e2bProvider.terminateWorkspace(ws.externalInstanceId);
      } catch (err) {
        logger.warn(
          `[anon-kill] E2B terminate failed for ${input.workspaceId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Continue to update the DB row even if E2B says it's already gone
      }

      // Clean up route access
      await deleteWorkspaceRouteAccess(input.workspaceId, null).catch(
        () => undefined,
      );

      // Update workspace status
      const now = new Date();
      await updateWorkspaceByIdReturningAndInvalidate(input.workspaceId, {
        status: "terminated",
        stoppedAt: now,
        terminatedAt: now,
        upstreamUrl: null,
        externalInstanceId: "",
      });

      // Clear the anon cookie so the old token can't be replayed
      ctx.honoContext.header("Set-Cookie", buildAnonCookieClearHeader(), {
        append: true,
      });

      const ipHash = ctx.clientIp
        ? hashClientIp(ctx.clientIp).slice(0, 8)
        : "unknown";
      logger.info(
        `[anon-kill] workspace=${input.workspaceId} ipHash=${ipHash}`,
      );

      return { success: true };
    }),
});
