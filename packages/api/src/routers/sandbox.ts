import { randomUUID } from "node:crypto";
import z from "zod";
import { TRPCError } from "@trpc/server";
import { and, db, desc, eq, inArray, or } from "@gitterm/db";
import { agentType, cloudProvider, image, machineProfile } from "@gitterm/db/schema/cloud";
import { workspace } from "@gitterm/db/schema/workspace";
import {
  SANDBOX_PROVIDER_PROFILES,
  SANDBOX_PROVIDERS,
  SandboxProviderError,
  type SandboxProviderKey,
} from "@gitterm/agent-runtime/sandbox/types";
import { accountProcedure, router } from "../index";
import { canUseProvider, getBilling } from "../billing";
import {
  managedSandboxTransport,
  parseSandboxHandle,
  sandboxHandle,
} from "../service/sandbox-transport";
import {
  getDefaultMachineProfile,
  getSelectableMachineProfiles,
} from "../providers/machine-profile";
import { reserveWorkspace, settleWorkspaceProvisioning } from "../service/workspace-provisioning";
import { createUsageSession } from "../utils/metering";
import { recordWorkspaceActivity } from "../service/workspace-activity";
import { getWorkspaceIdleTimeoutMs } from "../service/workspace-timeouts";
import { processWorkspaceTermination, terminateWorkspace } from "../service/workspace-termination";
import { updateWorkspaceByIdAndInvalidate } from "../service/workspace-mutations";
import { workspaceMetadataSchema } from "./workspace/managment";
import { isAnonEmail } from "../service/anon/anon-user";

/**
 * Managed sandboxes: plain provider sandboxes billed as Gitterm workspaces. Each is a
 * `workspace` row on the seeded `sandbox` agent type, so plan limits, usage sessions,
 * idle pausing, `autoTerminateAt`, and the termination queue apply unchanged. No agent
 * or model credential is installed. Jobs, source sync, and artifacts are built by the
 * SDK on top of these primitives.
 */

export const SANDBOX_AGENT_KEY = "sandbox";
const MAX_FILE_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;

const sandboxIdSchema = z.object({ sandboxId: z.uuid() });
const sandboxPathSchema = z
  .string()
  .min(2)
  .max(4096)
  .refine(
    (path) => path.startsWith("/") && !path.includes("\0") && !path.split("/").includes(".."),
    "Use an absolute path without '..'",
  );

const MAX_LIFETIME_MINUTES =
  Math.max(
    ...Object.values(SANDBOX_PROVIDER_PROFILES).map(
      (profile) => profile.capabilities.maxLifetimeMs,
    ),
  ) / 60_000;

type SandboxRow = { workspace: typeof workspace.$inferSelect; provider: SandboxProviderKey };

async function transportFor(row: SandboxRow) {
  const handle = parseSandboxHandle(row.workspace.externalInstanceId);
  if (!handle) throw new TRPCError({ code: "CONFLICT", message: "Sandbox is not provisioned" });
  return {
    transport: await managedSandboxTransport(handle.provider, row.workspace.cloudProviderId),
    id: handle.id,
  };
}

function toTRPCError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof SandboxProviderError) {
    // Provider auth failures are the deployment's problem, not the caller's credentials.
    throw new TRPCError({
      code:
        error.code === "not_found"
          ? "NOT_FOUND"
          : error.code === "rate_limited"
            ? "TOO_MANY_REQUESTS"
            : error.code === "timeout"
              ? "TIMEOUT"
              : "BAD_GATEWAY",
      message:
        error.code === "auth"
          ? "The deployment's provider credential was rejected. Ask an admin to check it."
          : error.message,
    });
  }
  throw error;
}

function present({ workspace: row, provider }: SandboxRow) {
  return {
    id: row.id,
    provider,
    name: row.name,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.startedAt.toISOString(),
    pausedAt: row.pausedAt?.toISOString() ?? null,
    terminatedAt: row.terminatedAt?.toISOString() ?? null,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    expiresAt: row.autoTerminateAt?.toISOString() ?? null,
    machineProfileId: row.machineProfileId,
  };
}

/** Another user's id, or a non-sandbox workspace, is indistinguishable from a missing one. */
const sandboxColumns = { workspace, provider: cloudProvider.providerKey };

async function loadSandbox(userId: string, sandboxId: string): Promise<SandboxRow> {
  const [row] = await db
    .select(sandboxColumns)
    .from(workspace)
    .innerJoin(cloudProvider, eq(workspace.cloudProviderId, cloudProvider.id))
    .innerJoin(image, eq(workspace.imageId, image.id))
    .innerJoin(agentType, eq(image.agentTypeId, agentType.id))
    .where(
      and(
        eq(workspace.id, sandboxId),
        eq(workspace.userId, userId),
        eq(agentType.key, SANDBOX_AGENT_KEY),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox not found" });
  return row as SandboxRow;
}

async function loadRunningSandbox(userId: string, sandboxId: string) {
  const row = await loadSandbox(userId, sandboxId);
  const record = row.workspace;
  if (record.status === "terminated")
    throw new TRPCError({ code: "NOT_FOUND", message: "Sandbox has been terminated" });
  if (record.status !== "running")
    throw new TRPCError({
      code: "CONFLICT",
      message: `Sandbox is ${record.status}. Resume it before running commands.`,
    });
  // Calls through this API are the sandbox's activity: they hold off idle pausing.
  await recordWorkspaceActivity(record.id);
  return transportFor(row);
}

export const sandboxRouter = router({
  create: accountProcedure("workspace:write")
    .input(
      z.object({
        provider: z.enum(SANDBOX_PROVIDERS).default("e2b"),
        name: z.string().trim().min(1).max(120).optional(),
        lifetimeMinutes: z.number().int().min(1).max(MAX_LIFETIME_MINUTES),
        publicPreviews: z.boolean().optional(),
        metadata: workspaceMetadataSchema.optional(),
        idempotencyKey: z.string().trim().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      if (isAnonEmail(ctx.session.user.email))
        throw new TRPCError({ code: "FORBIDDEN", message: "Sign in to create sandboxes." });

      if (input.idempotencyKey) {
        const existing = await db.query.workspace.findFirst({
          where: and(
            eq(workspace.userId, userId),
            eq(workspace.idempotencyKey, input.idempotencyKey),
          ),
        });
        if (existing) return present(await loadSandbox(userId, existing.id));
      }
      const maxMinutes =
        SANDBOX_PROVIDER_PROFILES[input.provider].capabilities.maxLifetimeMs / 60_000;
      if (input.lifetimeMinutes > maxMinutes) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${input.provider} sandboxes live at most ${maxMinutes} minutes`,
        });
      }

      const sandboxImage = await db
        .select({ image, agentType })
        .from(image)
        .innerJoin(agentType, eq(image.agentTypeId, agentType.id))
        .where(and(eq(agentType.key, SANDBOX_AGENT_KEY), eq(image.isEnabled, true)))
        .limit(1)
        .then((rows) => rows[0]);
      const provider = await db.query.cloudProvider.findFirst({
        where: and(
          eq(cloudProvider.providerKey, input.provider),
          eq(cloudProvider.isEnabled, true),
        ),
      });
      if (!sandboxImage || !provider)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `This deployment has not enabled managed ${input.provider} sandboxes.`,
        });

      const billing = await getBilling();
      const entitlements = await billing.getEntitlements(userId);
      if (!canUseProvider(entitlements, provider.providerKey))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan cannot use ${input.provider} compute.`,
        });

      // A sandbox runs the provider's default size and is billed at its default machine profile.
      const profiles = await db.query.machineProfile.findMany({
        where: and(
          eq(machineProfile.cloudProviderId, provider.id),
          eq(machineProfile.isEnabled, true),
        ),
      });
      const profile = getDefaultMachineProfile(
        getSelectableMachineProfiles(
          profiles,
          provider.machineSelectionPolicy.mode,
          entitlements.machineAccess,
        ),
      );

      const allowance = await billing.checkRunAllowance(userId, {
        action: "create",
        machineProfileId: profile?.id,
      });
      if (!allowance.allowed) throw new TRPCError({ code: "FORBIDDEN", message: allowance.reason });
      if (entitlements.maxWorkspaces !== null) {
        const active = await db
          .select({ id: workspace.id })
          .from(workspace)
          .where(
            and(
              eq(workspace.userId, userId),
              or(
                eq(workspace.status, "running"),
                eq(workspace.status, "pending"),
                eq(workspace.status, "paused"),
              ),
            ),
          );
        if (active.length >= entitlements.maxWorkspaces)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `You've reached your plan limit of ${entitlements.maxWorkspaces} workspaces and sandboxes.`,
          });
      }

      const transport = await managedSandboxTransport(input.provider, provider.id);
      const id = randomUUID();
      const now = new Date();
      const lifetimeMs = input.lifetimeMinutes * 60_000;
      await reserveWorkspace(
        {
          id,
          externalInstanceId: "",
          userId,
          imageId: sandboxImage.image.id,
          cloudProviderId: provider.id,
          machineProfileId: profile?.id ?? null,
          domain: "",
          status: "pending",
          serverOnly: true,
          name: input.name ?? "Sandbox",
          metadata: input.metadata ?? {},
          idempotencyKey: input.idempotencyKey ?? null,
          autoTerminateAt: new Date(now.getTime() + lifetimeMs),
          startedAt: now,
          updatedAt: now,
        },
        null,
      );

      let externalId: string;
      try {
        const created = await transport.create({
          labels: { gitterm_workspace: id, gitterm_workload: "sandbox", gitterm_user: userId },
          // Same as managed agent workspaces: idle time pauses, the lifetime terminates.
          timeoutMs: Math.max(
            60_000,
            Math.min(lifetimeMs, await getWorkspaceIdleTimeoutMs(userId)),
          ),
          onTimeout: "pause",
          publicPreviews: input.publicPreviews,
        });
        externalId = sandboxHandle(input.provider, created.id);
      } catch (error) {
        await updateWorkspaceByIdAndInvalidate(id, {
          status: "terminated",
          terminatedAt: new Date(),
          updatedAt: new Date(),
        });
        toTRPCError(error);
      }

      const settled = await settleWorkspaceProvisioning(
        {
          id,
          userId,
          externalInstanceId: externalId,
          status: "running",
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        },
        null,
        null,
        async (tx) => {
          await createUsageSession(id, userId, tx);
        },
      );
      if (settled.cancelled) {
        await processWorkspaceTermination(userId, id).catch(() => {});
        throw new TRPCError({ code: "CONFLICT", message: "Sandbox creation was cancelled" });
      }
      return present({ workspace: settled.workspace, provider: input.provider });
    }),

  list: accountProcedure("workspace:read")
    .input(z.object({ includeTerminated: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const rows = await db
        .select(sandboxColumns)
        .from(workspace)
        .innerJoin(cloudProvider, eq(workspace.cloudProviderId, cloudProvider.id))
        .innerJoin(image, eq(workspace.imageId, image.id))
        .innerJoin(agentType, eq(image.agentTypeId, agentType.id))
        .where(
          and(
            eq(workspace.userId, ctx.session.user.id),
            eq(agentType.key, SANDBOX_AGENT_KEY),
            input?.includeTerminated
              ? undefined
              : inArray(workspace.status, ["pending", "running", "paused"]),
          ),
        )
        .orderBy(desc(workspace.startedAt))
        .limit(200);
      return rows.map((row) => present(row as SandboxRow));
    }),

  get: accountProcedure("workspace:read")
    .input(sandboxIdSchema)
    .query(async ({ input, ctx }) =>
      present(await loadSandbox(ctx.session.user.id, input.sandboxId)),
    ),

  run: accountProcedure("workspace:access")
    .input(
      sandboxIdSchema.extend({
        command: z.string().min(1).max(200_000),
        cwd: sandboxPathSchema.optional(),
        timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
        // Transits this server for the call only; never stored or logged.
        env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { transport, id } = await loadRunningSandbox(ctx.session.user.id, input.sandboxId);
      try {
        return await transport.run(id, input.command, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs,
          env: input.env,
        });
      } catch (error) {
        toTRPCError(error);
      }
    }),

  writeFile: accountProcedure("workspace:access")
    .input(
      sandboxIdSchema.extend({
        path: sandboxPathSchema,
        contentBase64: z
          .string()
          .max(Math.ceil(MAX_FILE_CHUNK_BYTES / 3) * 4)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { transport, id } = await loadRunningSandbox(ctx.session.user.id, input.sandboxId);
      try {
        await transport.writeFile(id, input.path, Buffer.from(input.contentBase64, "base64"));
        return { success: true as const };
      } catch (error) {
        toTRPCError(error);
      }
    }),

  readFile: accountProcedure("workspace:access")
    .input(sandboxIdSchema.extend({ path: sandboxPathSchema }))
    .mutation(async ({ input, ctx }) => {
      const { transport, id } = await loadRunningSandbox(ctx.session.user.id, input.sandboxId);
      try {
        const bytes = await transport.readFile(id, input.path);
        if (bytes.byteLength > MAX_READ_BYTES)
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: "Managed sandboxes return files up to 32 MiB",
          });
        return { contentBase64: Buffer.from(bytes).toString("base64") };
      } catch (error) {
        toTRPCError(error);
      }
    }),

  preview: accountProcedure("workspace:access")
    .input(sandboxIdSchema.extend({ port: z.number().int().min(1).max(65535) }))
    .mutation(async ({ input, ctx }) => {
      const { transport, id } = await loadRunningSandbox(ctx.session.user.id, input.sandboxId);
      try {
        return await transport.preview(id, input.port);
      } catch (error) {
        toTRPCError(error);
      }
    }),

  terminate: accountProcedure("workspace:write")
    .input(sandboxIdSchema)
    .mutation(async ({ input, ctx }) => {
      const { workspace: record } = await loadSandbox(ctx.session.user.id, input.sandboxId);
      if (record.status !== "terminated") await terminateWorkspace(record.userId, record.id, false);
      return { success: true as const };
    }),
});
