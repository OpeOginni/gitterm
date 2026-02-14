import { getSandbox, proxyToSandbox, Sandbox } from "@cloudflare/sandbox";
import { createOpencode } from "@cloudflare/sandbox/opencode";
import { OpencodeClient } from "@opencode-ai/sdk";
import type { CloudSessionDestroyConfig, CloudSessionSpawnConfig, SandboxCredential } from "../../../../compute";

export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  INTERNAL_API_KEY: string;
}

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  error?: string;
  result?: T;
};

function ok<T>(result?: T, message?: string): Response {
  const body: ApiResponse<T> = { success: true };
  if (message) body.message = message;
  if (result !== undefined) body.result = result;
  return Response.json(body);
}

function fail(status: number, error: string, message?: string): Response {
  const body: ApiResponse<never> = { success: false, error };
  if (message) body.message = message;
  return Response.json(body, { status });
}

async function setupAuth(
  sandbox: Sandbox<unknown>,
  client: OpencodeClient,
  providerId: string,
  credential: SandboxCredential,
): Promise<{ success: boolean; error?: string }> {
  if (credential.type === "api_key") {
    try {
      await client.auth.set({
        path: { id: providerId },
        body: { type: "api", key: credential.apiKey },
      });
      console.log(`Auth set successfully for provider ${providerId}`);
      return { success: true };
    } catch (error) {
      console.error(`Failed to set auth:`, error);
      return {
        success: false,
        error: `Failed to set auth: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  const authJsonPath = "/root/.local/share/opencode/auth.json";

  const providerKeyMap: Record<string, string> = {
    openai: "openai",
    "openai-codex": "openai",
  };
  const authJsonKey = providerKeyMap[credential.providerName] ?? credential.providerName;

  // Build the auth.json content
  const authJson: Record<string, unknown> = {};
  authJson[authJsonKey] = {
    type: "oauth",
    refresh: credential.refresh,
    access: credential.access,
    expires: credential.expires,
  };

  try {
    await sandbox.mkdir("/root/.local/share/opencode", { recursive: true });

    await sandbox.writeFile(authJsonPath, JSON.stringify(authJson, null, 2));
    return { success: true };
  } catch (error) {
    console.error(`Failed to write auth.json:`, error);
    return {
      success: false,
      error: `Failed to write auth.json: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Run cloud session and return server connection url and session id
 */
async function spawnCloudSession(
  config: CloudSessionSpawnConfig,
  sandbox: Sandbox<unknown>,
  hostname: string,
): Promise<{
  success: boolean;
  error?: string;
  sessionId?: string;
  exposedServerUrl?: string;
}> {
  const {
    repoOwner,
    repoName,
    branch,
    gitAuthToken,
    providerName,
    credential,
  } = config;

  const repoPath = `${repoOwner}/${repoName}`;
  const repoDir = `/root/workspace/${repoName}`;
  const EXPOSED_OPENCODE_SERVER_PORT = 4096;

  const repoUrl = `https://x-access-token:${gitAuthToken}@github.com/${repoPath}.git`;
  const checkoutResult = await sandbox.gitCheckout(repoUrl, {
    branch: branch,
    targetDir: repoDir,
  });

  if (!checkoutResult.success) {
    const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;

    return {
      success: false,
      error: errorMsg,
    };
  }

  const { client, server } = await createOpencode(sandbox, {
    directory: repoDir,
    port: EXPOSED_OPENCODE_SERVER_PORT,
  });

  const exposed = await sandbox.exposePort(EXPOSED_OPENCODE_SERVER_PORT, { hostname });

  const authResult = await setupAuth(sandbox, client as OpencodeClient, providerName, credential);

  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error,
    };
  }

  if (config.existingSessionExport) {
    const sessionExportPath = `${repoDir}/.opencode-session-import.json`;

    try {
      config.existingSessionExport.info.directory = repoDir;
      await sandbox.writeFile(
        sessionExportPath,
        JSON.stringify(config.existingSessionExport, null, 2),
      );
      await sandbox.exec(`cd ${repoDir} && opencode import .opencode-session-import.json`);
    } finally {
      await sandbox.deleteFile(sessionExportPath);
    }

    return {
      success: true,
      sessionId: config.existingSessionExport.info.id,
      exposedServerUrl: exposed.url,
    };
  }

  const session = await (client as OpencodeClient).session.create({
    query: { directory: repoDir },
  });

  if (session.error) {
    console.error("Failed to create session:", session.error);
    const errorMsg = `Failed to create session: ${JSON.stringify(session.error)}`;

    return {
      success: false,
      error: errorMsg,
    };
  }

  return {
    success: true,
    sessionId: session.data.id,
    exposedServerUrl: exposed.url,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const { hostname, pathname } = new URL(request.url);

    if (request.method === "POST" && pathname === "/destroy") {
      const config = await request.json<CloudSessionDestroyConfig>();

      const sandbox = getSandbox(env.Sandbox, config.gittermCloudSessionId);

      try {
        await sandbox.setEnvVars({
          CLOUD_SESSION_ID: config.gittermCloudSessionId,
          BASE_COMMIT_SHA: config.baseCommitSha,
        });

        const repoDir = `/root/workspace/${config.repoName}`

        const applyPatchPath = `/persist/patch/apply.patch`;

        console.log("Destroy: repo-path.txt", repoDir);

        await sandbox.mkdir("/persist/patch", { recursive: true })

        await sandbox.exec(
          `repoDir="${repoDir}"
           git -C "$repoDir" add -A
           git -C "$repoDir" diff --cached "$BASE_COMMIT_SHA" > "${applyPatchPath}"`,
        );

        const applyPatchResult = await sandbox.readFile(applyPatchPath);
        const applyPatchRaw =
          typeof applyPatchResult === "string" ? applyPatchResult : applyPatchResult.content;
        const applyPatch = applyPatchRaw.trim() ? applyPatchRaw : null;

        await sandbox.destroy();

        return ok(
          {
            patches: {
              apply: applyPatch || null,
            },
          },
          "Cloud session destroyed",
        );
      } catch (error) {
        console.error("Failed to destroy cloud session:", error);

        return fail(
          500,
          error instanceof Error ? error.message : "Unknown error",
          "Failed to destroy cloud session",
        );
      }
    }

    const authorization = request.headers.get("Authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!authorization || !token || token !== env.INTERNAL_API_KEY) {
      return fail(401, "Unauthorized", "Unauthorized");
    }

    const config = await request.json<CloudSessionSpawnConfig>();

    const sandbox = getSandbox(env.Sandbox, config.gittermCloudSessionId);
    if (!sandbox.envVars["AWS_ACCESS_KEY_ID"] || !sandbox.envVars["AWS_SECRET_ACCESS_KEY"]) {
      return fail(
        500,
        "AWS credentials are missing from the sandbox environment variables.",
        "Internal Server Error: AWS credentials not found in sandbox.",
      );
    }

    try {
      await sandbox.setEnvVars({
        CLOUD_SESSION_ID: config.gittermCloudSessionId,
        BASE_COMMIT_SHA: config.baseCommitSha,
      });

      const result = await spawnCloudSession(config, sandbox, hostname);

      if (result.error) {
        return fail(500, result.error, "Failed to create cloud session");
      }

      return ok(result, "Cloud session created");
    } catch (error) {
      console.error("Failed to execute agent run:", error);

      return fail(
        500,
        error instanceof Error ? error.message : "Unknown error",
        "Failed to create cloud session",
      );
    }
  },
};
