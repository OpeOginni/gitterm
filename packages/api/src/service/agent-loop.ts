import { db, eq, and } from "@gitterm/db";
import { agentLoop, agentLoopRun } from "@gitterm/db/schema/agent-loop";
import { githubAppInstallation } from "@gitterm/db/schema/integrations";
import { cloudflareSandboxProvider } from "../providers/cloudflare";
import type { StartSandboxRunConfig } from "../providers/compute";
import { getGitHubAppService } from "./github";
import { logger } from "../utils/logger";
import env from "@gitterm/env/server";

/**
 * Configuration for executing an agent loop run
 */
export interface ExecuteRunConfig {
  /** The loop ID */
  loopId: string;
  /** The run ID */
  runId: string;
  /** AI provider (e.g., "anthropic") */
  provider: string;
  /** Model identifier (e.g., "anthropic/claude-sonnet-4-20250514") */
  model: string;
  /** API key for the AI provider */
  apiKey: string;
  /** Custom prompt (optional - will use default if not provided) */
  prompt?: string;
}

/**
 * Result from starting a run (async mode)
 */
export interface StartRunResult {
  success: boolean;
  runId: string;
  sandboxId?: string;
  error?: string;
  /** True if the run was started asynchronously and will callback when done */
  async?: boolean;
}

/**
 * Result from executing a run (sync mode - legacy)
 */
export interface ExecuteRunResult {
  success: boolean;
  runId: string;
  commitSha?: string;
  commitMessage?: string;
  error?: string;
  durationSeconds?: number;
  isComplete?: boolean; // True if agent says the plan is complete
}

/**
 * Agent Loop Service
 *
 * Handles the execution of agent loop runs:
 * - Fetches loop and run data
 * - Gets GitHub token for git operations
 * - Calls Cloudflare sandbox with callback URL
 * - Returns immediately (async mode)
 *
 * The actual completion handling is done by the internal callback endpoint
 * when the Cloudflare worker calls back.
 */
export class AgentLoopService {
  /**
   * Start a run asynchronously
   *
   * This method:
   * 1. Validates the run is in pending state
   * 2. Gets GitHub token
   * 3. Calls Cloudflare sandbox with callback URL
   * 4. Returns immediately - completion is handled via callback
   */
  async startRunAsync(config: ExecuteRunConfig): Promise<StartRunResult> {
    // Get the run with its loop
    const run = await db.query.agentLoopRun.findFirst({
      where: eq(agentLoopRun.id, config.runId),
      with: {
        loop: {
          with: {
            gitIntegration: true,
          },
        },
      },
    });

    if (!run) {
      return {
        success: false,
        runId: config.runId,
        error: "Run not found",
      };
    }

    if (run.status !== "pending") {
      return {
        success: false,
        runId: config.runId,
        error: `Run is in ${run.status} state, not pending`,
      };
    }

    const loop = run.loop;

    try {
      // Get GitHub token
      if (!loop.gitIntegration) {
        throw new Error("No git integration configured for this loop");
      }

      const [installation] = await db
        .select()
        .from(githubAppInstallation)
        .where(
          eq(githubAppInstallation.installationId, loop.gitIntegration.providerInstallationId),
        );

      if (!installation) {
        throw new Error("GitHub installation not found");
      }

      if (installation.suspended) {
        throw new Error("GitHub App installation is suspended");
      }

      const githubService = getGitHubAppService();
      const tokenData = await githubService.getUserToServerToken(installation.installationId, [
        loop.repositoryName,
      ]);

      // Generate prompt
      const prompt = cloudflareSandboxProvider.generatePrompt(
        loop.planFilePath,
        loop.progressFilePath || undefined,
        config.prompt,
      );

      // Use loop ID as sandbox ID - one instance per loop, reused across all runs
      const sandboxId = `${loop.id}-run-${run.runNumber}`;

      // Build callback URL - uses API_URL (server) for the webhook
      const listenerUrl = env.LISTENER_URL || env.BASE_URL;
      const callbackSecret = env.CLOUDFLARE_CALLBACK_SECRET;

      if (!listenerUrl || !callbackSecret) {
        throw new Error(
          "Callback configuration missing. Set API_URL (or BASE_URL) and CLOUDFLARE_CALLBACK_SECRET.",
        );
      }

      const callbackUrl = listenerUrl.includes("localhost")
        ? `https://bluebird-thankful-previously.ngrok-free.app/listener/trpc/agentLoop.handleWebhook`
        : `${listenerUrl}/trpc/agentLoop.handleWebhook`;

      // Call Cloudflare sandbox with callback URL
      const sandboxConfig: StartSandboxRunConfig = {
        sandboxId,
        repoOwner: loop.repositoryOwner,
        repoName: loop.repositoryName,
        branch: loop.branch,
        gitAuthToken: tokenData.token,
        planFilePath: loop.planFilePath,
        documentedProgressPath: loop.progressFilePath || undefined,
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        prompt,
        iteration: run.runNumber,
        callbackUrl,
        callbackSecret,
        runId: config.runId,
      };

      logger.info("Starting async sandbox run", {
        action: "sandbox_run_start_async",
        loopId: loop.id,
        runId: config.runId,
        runNumber: run.runNumber,
        sandboxId,
      });

      const result = await cloudflareSandboxProvider.startRun(sandboxConfig);

      if (!result.success) {
        // Immediate failure from sandbox provider - delete the pending run
        // User can try again after fixing the issue
        await db.delete(agentLoopRun).where(eq(agentLoopRun.id, config.runId));

        logger.error("Sandbox run failed to start", {
          action: "sandbox_run_start_failed",
          loopId: loop.id,
          runId: config.runId,
          error: result.error,
        });

        return {
          success: false,
          runId: config.runId,
          sandboxId,
          error: result.error,
        };
      }

      console.log("Updating the run to running");
      // NOW mark run as running - sandbox acknowledged and execution has started
      await db
        .update(agentLoopRun)
        .set({
          status: "running",
          startedAt: new Date(),
          modelProvider: config.provider,
          model: config.model,
          sandboxId,
        })
        .where(eq(agentLoopRun.id, config.runId));

      // Also update the loop with model config if not already set
      // This ensures automated runs can use the same config
      if (!loop.modelProvider || !loop.model) {
        await db
          .update(agentLoop)
          .set({
            modelProvider: config.provider,
            model: config.model,
            updatedAt: new Date(),
          })
          .where(eq(agentLoop.id, loop.id));
      }

      // Worker acknowledged - run is executing in background
      logger.info("Sandbox run started, awaiting callback", {
        action: "sandbox_run_started",
        loopId: loop.id,
        runId: config.runId,
        runNumber: run.runNumber,
        sandboxId,
        acknowledged: result.acknowledged,
      });

      return {
        success: true,
        runId: config.runId,
        sandboxId,
        async: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Pre-execution error (auth, config, etc.) - delete the pending run
      // User can fix the issue and try again
      await db.delete(agentLoopRun).where(eq(agentLoopRun.id, config.runId));

      logger.error(
        "Failed to start sandbox run (pre-execution error)",
        {
          action: "sandbox_run_preexec_error",
          loopId: loop.id,
          runId: config.runId,
        },
        error as Error,
      );

      return {
        success: false,
        runId: config.runId,
        error: errorMessage,
      };
    }
  }

  /**
   * Get loop statistics
   */
  async getLoopStats(loopId: string): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
    averageDuration: number | null;
  } | null> {
    const [loop] = await db.select().from(agentLoop).where(eq(agentLoop.id, loopId));

    if (!loop) {
      return null;
    }

    // Calculate average duration from completed runs
    const runs = await db.query.agentLoopRun.findMany({
      where: and(eq(agentLoopRun.loopId, loopId), eq(agentLoopRun.status, "completed")),
    });

    const durationsWithValue = runs.filter((r) => r.durationSeconds !== null);
    const averageDuration =
      durationsWithValue.length > 0
        ? durationsWithValue.reduce((sum, r) => sum + (r.durationSeconds || 0), 0) /
          durationsWithValue.length
        : null;

    return {
      totalRuns: loop.totalRuns,
      successfulRuns: loop.successfulRuns,
      failedRuns: loop.failedRuns,
      successRate: loop.totalRuns > 0 ? (loop.successfulRuns / loop.totalRuns) * 100 : 0,
      averageDuration,
    };
  }
}

// Singleton instance
let agentLoopServiceInstance: AgentLoopService | null = null;

export function getAgentLoopService(): AgentLoopService {
  if (!agentLoopServiceInstance) {
    agentLoopServiceInstance = new AgentLoopService();
  }
  return agentLoopServiceInstance;
}
