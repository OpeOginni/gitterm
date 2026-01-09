import { getSandbox, Sandbox } from "@cloudflare/sandbox";
import { createOpencode } from "@cloudflare/sandbox/opencode";
import { OpencodeClient, type BadRequestError, type NotFoundError } from "@opencode-ai/sdk";
import type { SandboxConfig } from "../../../compute";

export { Sandbox } from "@cloudflare/sandbox";

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
    model,
    apiKey,
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
    targetDir: `/home/user/workspace/${repoName}`,
  });

  if (!checkoutResult.success) {
    const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  const providerId = model.split("/")[0];
  const specificModel = model.split("/")[1];

  if (!providerId || !specificModel) {
    const errorMsg = "Provider ID or specific model not found";

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  const { client } = await createOpencode(sandbox, {
    directory: `/home/user/workspace/${repoName}`,
  });

  console.log(`Setting auth for provider ${providerId}...`);
  try {
    await (client as OpencodeClient).auth.set({
      path: { id: providerId },
      body: { type: "api", key: apiKey },
    });
    console.log(`Auth set successfully for provider ${providerId}`);
  } catch (error) {
    console.error(`Failed to set auth:`, error);
    const errorMsg = `Failed to set auth: ${error instanceof Error ? error.message : "Unknown error"}`;

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  console.log("Creating session...");
  const session = await (client as OpencodeClient).session.create({
    body: {
      title: `Agent Loop Iteration ${iteration}`,
    },
    query: { directory: `/home/user/workspace/${repoName}` },
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

      const result = await executeAgentRun(
        config,
        sandbox,
      );

      if (result.error) {
        return Response.json({
          success: false,
          error: result.error,
        }, { status: 500 });
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
