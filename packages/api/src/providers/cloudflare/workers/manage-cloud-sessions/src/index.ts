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

  if (!checkoutResult.success) {
    const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;

    return {
      success: false,
      error: errorMsg,
    };
  }

  const { client, server } = await createOpencode(sandbox, {
    directory: `/root/workspace/${repoName}`,
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

  if(config.existingSessionExport){
    await (client as OpencodeClient).session.import({ directory: `/root/workspace/${repoName}`, sessionExport: config.existingSessionExport})

    return {
        success: true,
        sessionId: config.existingSessionExport.info.id,
        exposedServerUrl: exposed.url,
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

    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;
    
    const { hostname, pathname } = new URL(request.url);

    if(request.method === "POST" && pathname === "/destroy") {
        const config = await request.json<CloudSessionDestroyConfig>();

        const sandbox = getSandbox(env.Sandbox, config.gittermCloudSessionId);
        
        try {
            await sandbox.exec('git commit -m "Session Prompt Commit"')
    
            await sandbox.exec(`git diff $BASE_COMMIT_SHA > /persist/cloud-sessions/${config.gittermCloudSessionId}/apply.patch`)
            await sandbox.exec(`git diff $BASE_COMMIT_SHA --reverse > /persist/cloud-sessions/${config.gittermCloudSessionId}/revert.patch`)
      
            await sandbox.destroy();
    
            return Response.json({
                success: true,
                message: "Cloud session destroyed",
            });
        } catch (error) {
          console.error("Failed to destroy cloud session:", error);
    
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
          );
        } 
    }

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
    if(!sandbox.envVars["AWS_ACCESS_KEY_ID"] || !sandbox.envVars["AWS_SECRET_ACCESS_KEY"]) {
      return Response.json(
        {
          error: "AWS credentials are missing from the sandbox environment variables.",
          success: false,
          message: "Internal Server Error: AWS credentials not found in sandbox.",
        },
        { status: 500 },
      );
    }

    try {
      await sandbox.setEnvVars({
        CLOUD_SESSION_ID: config.gittermCloudSessionId,
        BASE_COMMIT_SHA: config.baseCommitSha,
        AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY
      });

      await sandbox.mountBucket('opencode-cloud-sessions', '/persist', {
        endpoint: 'https://dea3902b0808872213b16655005fac5b.r2.cloudflarestorage.com',
        prefix: `/cloud-sessions/${config.gittermCloudSessionId}/`,
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
