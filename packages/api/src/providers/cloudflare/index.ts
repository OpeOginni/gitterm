import env from "@gitterm/env/server";
import type { StartSandboxRunConfig } from "../compute";
import { getProviderConfigService } from "../../service/config/provider-config";

/**
 * Response from the Cloudflare sandbox worker
 */
export interface SandboxResponse {
  sandboxId: string;
  response: any;
  latestCommitHash: string;
  latestCommitMessage: string;
  success: boolean;
  message: string;
}

export interface SandboxErrorResponse {
  error: string;
  success: false;
  message: string;
}

interface CloudflareConfig {
  workerUrl: string;
  callbackSecret: string;
}

/**
 * Acknowledgement response when using async callback mode
 */
export interface SandboxAckResponse {
  success: true;
  acknowledged: true;
  sandboxId: string;
  message: string;
}

/**
 * Result from a sandbox run
 */
export interface SandboxRunResult {
  success: boolean;
  sandboxId: string;
  commitSha?: string;
  commitMessage?: string;
  response?: any;
  error?: string;
  acknowledged?: boolean;
}

/**
 * Cloudflare Sandbox Provider
 *
 * Provides methods to interact with the Cloudflare sandbox worker
 * for running autonomous coding agents.
 */
export class CloudflareSandboxProvider {
  readonly name = "cloudflare";
  private config: CloudflareConfig | null = null;

  async getConfig(): Promise<CloudflareConfig | null> {
    if (this.config) {
      return this.config;
    }

    try {
      const dbConfig = await getProviderConfigService().getProviderConfigForUse("cloudflare");
      if (!dbConfig) {
        return null;
      }
      this.config = dbConfig as CloudflareConfig;
      return this.config;
    } catch (error) {
      console.warn(
        "[CloudflareProvider] Failed to load config from database, falling back to env vars:",
        error
      );
      return null;
    }
  }


  /**
   * Check if the Cloudflare sandbox is configured
   */
  async isConfigured(): Promise<boolean> {
    const cloudflareConfig = await this.getConfig();
    return !!cloudflareConfig?.workerUrl;
  }

  /**
   * Start a sandbox run
   *
   * If callbackUrl is provided, this returns immediately after the worker
   * acknowledges the request. The worker will POST results to the callback
   * URL when the run completes.
   *
   * If no callbackUrl is provided, this waits for the full run to complete
   * and returns the result (original behavior).
   */
  async startRun(config: StartSandboxRunConfig): Promise<SandboxRunResult> {
    const cloudflareConfig = await this.getConfig();

    if (!cloudflareConfig?.workerUrl) {
      return {
        success: false,
        sandboxId: config.sandboxId,
        error: "Cloudflare sandbox is not configured. Set cloudflare worker url in admin portal.",
      };
    }

    // Map to worker's expected field names (SandboxConfig)
    const requestBody = {
      userSandboxId: config.sandboxId, // Worker uses userSandboxId
      repoOwner: config.repoOwner,
      repoName: config.repoName,
      branch: config.branch,
      modelId: config.modelId,
      credential: config.credential,
      gitAuthToken: config.gitAuthToken,
      prompt: config.prompt,
      featureListPath: config.planFilePath, // Worker uses featureListPath
      documentedProgressPath: config.documentedProgressPath || "",
      iteration: config.iteration,
      callbackUrl: config.callbackUrl,
      callbackSecret: config.callbackSecret,
      runId: config.runId,
    };

    try {
      fetch(cloudflareConfig.workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      return {
        success: true,
        sandboxId: config.sandboxId,
        acknowledged: true,
      };
    } catch (error) {
      return {
        success: false,
        sandboxId: config.sandboxId,
        error: error instanceof Error ? error.message : "Unknown error calling sandbox worker",
      };
    }
  }

  /**
   * Generate a default prompt for the agent
   */
  generatePrompt(
    planFilePath: string,
    progressFilePath?: string,
    userCustomPrompt?: string,
  ): string {
    let prompt = `Read the plan at @${planFilePath} and implement the next feature on the list.`;

    if (progressFilePath) {
      prompt += ` Update @${progressFilePath} with your progress after completing the feature.`;
    }

    if (userCustomPrompt) {
      prompt += ` ${userCustomPrompt}`;
    }

    prompt += ` Make sure to COMMIT and PUSH your changes when done.`;
    prompt += ` ONLY WORK ON A SINGLE FEATURE.`;
    prompt += ` If the picked plan is complete mark it in the plan file as such, output <promise>COMPLETE</promise>.`;

    return prompt;
  }
}

// Singleton instance
export const cloudflareSandboxProvider = new CloudflareSandboxProvider();
