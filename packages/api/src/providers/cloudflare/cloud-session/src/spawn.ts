import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { createOpencode } from "@cloudflare/sandbox/opencode";
import { OpencodeClient } from "@opencode-ai/sdk";
import type { CloudSessionSpawnConfig, SandboxCredential } from "../../../compute";

export { Sandbox } from "@cloudflare/sandbox";

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
  const EXPOSED_OPENCODE_SERVER_PORT = 4096;

  const repoUrl = `https://x-access-token:${gitAuthToken}@github.com/${repoPath}.git`;
  const checkoutResult = await sandbox.gitCheckout(repoUrl, {
    branch: branch,
    targetDir: `/root/workspace/${repoName}`,
  });

  const exposed = await sandbox.exposePort(EXPOSED_OPENCODE_SERVER_PORT, { hostname });
  
  if (!checkoutResult.success) {
    const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;

    return {
      success: false,
      error: errorMsg,
    };
  }

  const { client, server } = await createOpencode(sandbox, {
    directory: `/root/workspace/${repoName}`,
    port: EXPOSED_OPENCODE_SERVER_PORT
  });

  const authResult = await setupAuth(sandbox, client as OpencodeClient, providerName, credential);

  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error,
    };
  }

  const session = await (client as OpencodeClient).session.create({
    query: { directory: `/root/workspace/${repoName}` },
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
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    const { hostname } = new URL(request.url);

    const authorization = request.headers.get("Authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!authorization || !token || token !== env.INTERNAL_API_KEY) {
      return Response.json(
        {
          error: "Unauthorized",
          success: false,
          message: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const config = await request.json<CloudSessionSpawnConfig>();

    const sandbox = getSandbox(env.Sandbox, config.gittermCloudSessionId);

    try {
      await sandbox.setEnvVars({
        CLOUD_SESSION_ID: config.gittermCloudSessionId,
        BASE_COMMIT_SHA: config.baseCommitSha,
      });

      await sandbox.mountBucket('cloud-sessions', '/persist', {
        endpoint: 'https://.r2.cloudflarestorage.com',
        prefix: `/cloud-sessions/${config.gittermCloudSessionId}/`
      });
      
      const result = await spawnCloudSession(config, sandbox, hostname);

      if (result.error) {
        return Response.json(
          {
            success: false,
            error: result.error,
          },
          { status: 500 },
        );
      }

      return Response.json({
        success: true,
        message: "Cloud session created",
        result,
      });
    } catch (error) {
      console.error("Failed to execute agent run:", error);

      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
};
