import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { createOpencode } from "@cloudflare/sandbox/opencode";
import { OpencodeClient, type BadRequestError, type NotFoundError } from "@opencode-ai/sdk";
import type { SandboxConfig, SandboxCredential } from "../../../compute";

export { Sandbox } from "@cloudflare/sandbox";
/**
 * Set up authentication for the AI provider.
 * For API keys, use the SDK auth.set method.
 * For OAuth (GitHub Copilot), write an auth.json file.
 */
async function setupAuth(
  sandbox: Sandbox<unknown>,
  client: OpencodeClient,
  providerId: string,
  credential: SandboxCredential,
): Promise<{ success: boolean; error?: string }> {
  if (credential.type === "api_key") {
    // API key auth - use the SDK
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

  // OAuth auth - write auth.json file
  // The sandbox runs as root, so the path is /root/.local/share/opencode/auth.json
  const authJsonPath = "/root/.local/share/opencode/auth.json";

  // Map provider names to their auth.json key
  // Both openai and openai-codex (Codex subscription) should use "openai" as the key
  // since only one can be used in a sandbox at a time
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
    // Ensure the directory exists using the sandbox API
    await sandbox.mkdir("/root/.local/share/opencode", { recursive: true });

    // Write the auth.json file
    await sandbox.writeFile(authJsonPath, JSON.stringify(authJson, null, 2));
    console.log(
      `OAuth auth.json written with key "${authJsonKey}" for provider ${credential.providerName}`,
    );
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
 * Execute the agent run and return the result
 */
async function executeAgentRun(
  config: SandboxConfig,
  sandbox: Sandbox<unknown>,
): Promise<{
  success: boolean;
  error?: string;
  sandboxId: string;
}> {
  const {
    userSandboxId,
    repoOwner,
    repoName,
    branch,
    gitAuthToken,
    prompt,
    featureListPath,
    documentedProgressPath,
    modelId,
    credential,
    iteration,
  } = config;

  const repoPath = `${repoOwner}/${repoName}`;

  await sandbox.writeFile(
    "/workspace/.git-credential-helper.sh",
    `#!/bin/sh
if [ "$1" = "get" ]; then
    echo "protocol=https"
    echo "host=github.com"
    echo "username=x-access-token"
    echo "password=${gitAuthToken}"
fi
`,
  );

  await sandbox.exec(
    "git config --global credential.helper '/workspace/.git-credential-helper.sh'",
  );

  await sandbox.exec('git config --global user.name "Opencode: Gitterm"');
  await sandbox.exec('git config --global user.email "opencode@gitterm.dev"');

  const repoUrl = `https://x-access-token:${gitAuthToken}@github.com/${repoPath}.git`;
  const checkoutResult = await sandbox.gitCheckout(repoUrl, {
    branch: branch,
    targetDir: `/root/workspace/${repoName}`,
  });

  if (!checkoutResult.success) {
    const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  const providerId = modelId.split("/")[0];
  const specificModel = modelId.split("/")[1];

  if (!providerId || !specificModel) {
    const errorMsg = "Provider ID or specific model not found";

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  const { client } = await createOpencode(sandbox, {
    directory: `/root/workspace/${repoName}`,
  });

  // Set up authentication based on credential type
  console.log(`Setting auth for provider ${providerId}...`);
  const authResult = await setupAuth(sandbox, client as OpencodeClient, providerId, credential);

  if (!authResult.success) {
    return {
      success: false,
      sandboxId: userSandboxId,
      error: authResult.error,
    };
  }

  console.log("Creating session...");
  const session = await (client as OpencodeClient).session.create({
    body: {
      title: `Agent Loop Iteration ${iteration}`,
    },
    query: { directory: `/root/workspace/${repoName}` },
  });

  if (session.error) {
    console.error("Failed to create session:", session.error);
    const errorMsg = `Failed to create session: ${JSON.stringify(session.error)}`;

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  console.log(`[Worker Log] Session created successfully: ${session.data.id}`);

  const fullPrompt = `You are working on the repository at branch "${branch}". 

CRITICAL CONSTRAINTS:
1. DO NOT checkout, switch, or create any branches. Stay on the current branch "${branch}" at all times.
2. Work on ONE feature from the plan file (@${featureListPath}) completely - do not start multiple features.
3. You MUST commit AND push your changes before calling the agent-callback tool.

WORKFLOW:

STEP 1 - UNDERSTAND THE TASK:
- Read the plan file (@${featureListPath})${documentedProgressPath ? ` and the progress file (@${documentedProgressPath})` : ""}.
- Choose ONE incomplete feature to implement.

STEP 2 - IMPLEMENT:
- Implement the entire feature completely.
- Make all necessary code changes.
${documentedProgressPath ? `- Update the progress file (@${documentedProgressPath}) to document what you completed.` : ""}

STEP 3 - COMMIT AND PUSH:
- Stage all changes: git add -A
- Commit with a descriptive message: git commit -m "feat: [description]"
- Push to remote: git push

STEP 4 - CALL agent-callback:
- If you successfully committed and pushed, call agent-callback with success=true
- If you have completed the entire list of features in the plan file, call agent-callback with success=true and isListComplete=true
- If something went wrong, call agent-callback with success=false and describe the error

The agent-callback tool will automatically verify your commit. You do NOT need to provide the commit SHA or message - the tool fetches these automatically.

${prompt ? `ADDITIONAL INSTRUCTIONS:\n${prompt}\n` : ""}
IMPORTANT: You MUST call the agent-callback tool ONLY after you have: 1) Made changes for the feature, 2) Committed them, and 3) Pushed the changes to the remote repository.`;

  const result = await (client as OpencodeClient).session.prompt({
    path: { id: session.data.id },
    body: {
      model: { providerID: providerId, modelID: specificModel },
      parts: [
        {
          type: "text",
          text: fullPrompt,
        },
      ],
      tools: {
        "agent-callback": true,
      },
    },
  });

  console.log("COMPLETED OPENCODE SESSION");

  if (result.error?.data) {
    const error = result.error;
    let errorMsg = "Unknown error";

    if ((error as NotFoundError).name === "NotFoundError") {
      errorMsg = (error as NotFoundError).data.message;
    } else if ((error as BadRequestError).errors?.length > 0) {
      errorMsg = (error as BadRequestError).errors.map((error) => error.message).join(", ");
    }

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  return {
    success: true,
    sandboxId: userSandboxId,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
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

    const config = await request.json<SandboxConfig>();

    // Sandbox timeout - must match AGENT_LOOP_RUN_TIMEOUT_MINUTES in config/agent-loop.ts
    const sandbox = getSandbox(env.Sandbox, config.userSandboxId, {
      sleepAfter: "40m",
    });

    try {
      await sandbox.setEnvVars({
        AGENT_CALLBACK_URL: config.callbackUrl,
        AGENT_CALLBACK_SECRET: config.callbackSecret,
        RUN_ID: config.runId,
        SANDBOX_ID: config.userSandboxId,
      });

      const result = await executeAgentRun(config, sandbox);

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
        message: "Run completed",
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
    } finally {
      await sandbox.destroy();
    }
  },
};
