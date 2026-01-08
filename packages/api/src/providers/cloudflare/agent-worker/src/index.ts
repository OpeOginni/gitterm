import { getSandbox, Sandbox } from '@cloudflare/sandbox';
import { createOpencode } from '@cloudflare/sandbox/opencode'
import { OpencodeClient, type BadRequestError, type NotFoundError} from '@opencode-ai/sdk';
import type { SandboxConfig } from '../../../compute';
import type { ExecutionContext } from "@cloudflare/workers-types/experimental";
import { DurableObject } from 'cloudflare:workers';

export { Sandbox } from '@cloudflare/sandbox';

/**
 * Send callback to the listener with run results
 */
async function sendCallback(
  callbackUrl: string,
  callbackSecret: string,
  payload: {
    runId: string;
    success: boolean;
    sandboxId?: string;
    commitSha?: string;
    commitMessage?: string;
    error?: string;
    isComplete?: boolean;
    durationSeconds?: number;
  }
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callbackSecret}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`Callback failed with status ${response.status}: ${await response.text()}`);
    } else {
      console.log('[Worker] Callback sent successfully');
    }
  } catch (error) {
    console.error('Failed to send callback:', error);
  }
}

/**
 * Execute the agent run and return the result
 */
async function executeAgentRun(
  config: SandboxConfig,
  sandbox: Sandbox<unknown>,
  callbackUrl?: string,
  callbackSecret?: string,
  runId?: string,
  startTime?: number
): Promise<{
  success: boolean;
  sandboxId: string;
  commitHash?: string;
  commitMessage?: string;
  response?: any;
  error?: string;
  isComplete?: boolean;
}> {
  const { userSandboxId, repoOwner, repoName, branch, gitAuthToken, prompt, featureListPath, documentedProgressPath, model, apiKey, iteration } = config;
  
  const repoPath = `${repoOwner}/${repoName}`;

  await sandbox.writeFile("/workspace/.git-credential-helper.sh", `#!/bin/sh
if [ "$1" = "get" ]; then
    echo "protocol=https"
    echo "host=github.com"
    echo "username=x-access-token"
    echo "password=${gitAuthToken}"
fi
`);

  await sandbox.exec("git config --global credential.helper '/workspace/.git-credential-helper.sh'");

  // Ensure we clone a specific branch by specifying the branch in the clone command
  const repoUrl = `https://x-access-token:${gitAuthToken}@github.com/${repoPath}.git`;
  const checkoutResult = await sandbox.gitCheckout(repoUrl, {
    branch: branch,
    targetDir: `/home/user/workspace/${repoName}`
  });

  if (!checkoutResult.success) {
    const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;
    
    // Send error callback if configured
    if (callbackUrl && callbackSecret && runId && startTime) {
      console.log('[Worker] Sending checkout error callback...');
      await sendCallback(callbackUrl, callbackSecret, {
        runId,
        success: false,
        sandboxId: userSandboxId,
        error: errorMsg,
        durationSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }
    
    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  const providerId = model.split("/")[0];
  const specificModel = model.split("/")[1];

  if (!providerId || !specificModel) {
    return {
      success: false,
      sandboxId: userSandboxId,
      error: "Provider ID or specific model not found",
    };
  }

  const { client } = await createOpencode(sandbox, {
    directory: `/home/user/workspace/${repoName}`
  })

  // Set auth
  console.log(`Setting auth for provider ${providerId}...`);
  try {
    await (client as OpencodeClient).auth.set({
      path: { id: providerId },
      body: { type: "api", key: apiKey },
    })
    console.log(`Auth set successfully for provider ${providerId}`);
  } catch (error) {
    console.error(`Failed to set auth:`, error);
    const errorMsg = `Failed to set auth: ${error instanceof Error ? error.message : 'Unknown error'}`;
    
    // Send error callback if configured
    if (callbackUrl && callbackSecret && runId && startTime) {
      console.log('[Worker] Sending auth error callback...');
      await sendCallback(callbackUrl, callbackSecret, {
        runId,
        success: false,
        sandboxId: userSandboxId,
        error: errorMsg,
        durationSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }
    
    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  // Create session
  console.log('Creating session...');
  const session = await (client as OpencodeClient).session.create({
    body: {
      title: `Agent Loop Iteration ${iteration}`
    },
    query: { directory: `/home/user/workspace/${repoName}` }
  })
  
  if (session.error) {
    console.error('Failed to create session:', session.error);
    const errorMsg = `Failed to create session: ${JSON.stringify(session.error)}`;
    
    // Send error callback if configured
    if (callbackUrl && callbackSecret && runId && startTime) {
      console.log('[Worker] Sending session creation error callback...');
      await sendCallback(callbackUrl, callbackSecret, {
        runId,
        success: false,
        sandboxId: userSandboxId,
        error: errorMsg,
        durationSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }
    
    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }
  
  console.log(`Session created successfully: ${session.data.id}`); 

  const fullPrompt = 
  `@${featureListPath} is the feature list for the project. @${documentedProgressPath} is the documented progress for the project, where you append your progress.
    ${prompt}
  ONLY WORK ON A SINGLE FEATURE.
  If, while implemeting the feature, you notice the PRD is complete, output <promise>COMPLETE</promise>.
  `

  const result = await (client as OpencodeClient).session.prompt({
    path: { id: session.data.id },
    body: {
      model: { providerID: providerId, modelID: specificModel },
      parts: [
        {
          type: "text",
          text: fullPrompt
        }
      ]
    }
  })

  console.log("COMPLETED OPENCODE SESSION")

  if (result.error?.data) {
    const error = result.error;
    let errorMsg = "Unknown error";

    if ((error as NotFoundError).name === "NotFoundError") {
      errorMsg = (error as NotFoundError).data.message;
    } else if ((error as BadRequestError).errors?.length > 0) {
      errorMsg = (error as BadRequestError).errors.map((error) => error.message).join(", ");
    }
    
    // Send error callback if configured
    if (callbackUrl && callbackSecret && runId && startTime) {
      console.log('[Worker] Sending prompt execution error callback...');
      await sendCallback(callbackUrl, callbackSecret, {
        runId,
        success: false,
        sandboxId: userSandboxId,
        error: errorMsg,
        durationSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }

    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }


  console.log("COMPLETED OPENCODE SESSION PROMPT")
  const latestCommit = await sandbox.exec(`cd /home/user/workspace/${repoName} && git log -1 --pretty=format:"%H %s"`);

  if (latestCommit.exitCode !== 0) {
    const errorMsg = `Failed to get latest commit: ${latestCommit.stderr || latestCommit.stdout}`;
    
    // Send error callback if configured
    if (callbackUrl && callbackSecret && runId && startTime) {
      console.log('[Worker] Sending commit check error callback...');
      await sendCallback(callbackUrl, callbackSecret, {
        runId,
        success: false,
        sandboxId: userSandboxId,
        error: errorMsg,
        durationSeconds: Math.floor((Date.now() - startTime) / 1000),
      });
    }
    
    return {
      success: false,
      sandboxId: userSandboxId,
      error: errorMsg,
    };
  }

  const commitHash = latestCommit.stdout.split(" ")[0];
  const commitMessage = latestCommit.stdout.split(" ").slice(1).join(" ");

  // Send success callback before returning (ensure it completes)
  if (callbackUrl && callbackSecret && runId && startTime) {
    console.log('[Worker] Sending success callback...');
    await sendCallback(callbackUrl, callbackSecret, {
      runId,
      success: true,
      sandboxId: userSandboxId,
      commitSha: commitHash,
      commitMessage,
      isComplete: true,
      durationSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
    console.log('[Worker] Success callback sent');
  }

  console.log("RETURNING FROM OPENCODE SESSION LATEST COMMIT", latestCommit);
  return {
    success: true,
    sandboxId: userSandboxId,
    commitHash,
    commitMessage,
    response: result.data,
    isComplete: true,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'POST') {
      const authorization = request.headers.get("Authorization");
      const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;

      if(!authorization || !token || token !== env.INTERNAL_API_KEY) {
        return Response.json({
          error: "Unauthorized",
          success: false,
          message: "Unauthorized",
        }, { status: 401 });
      }

      const config = await request.json<SandboxConfig>();

      const startTime = Date.now();
      // Get or create a sandbox instance (always with keepAlive: false)
      const sandbox = getSandbox(env.Sandbox, config.userSandboxId, {
        keepAlive: true,
      });

      try {
        await executeAgentRun(
          config, 
          sandbox,
          config.callbackUrl, 
          config.callbackSecret, 
          config.runId,
          startTime
        );

      } catch (error) {
        console.error('Failed to execute agent run:', error);
      } finally {
        await sandbox.destroy();
      }
    }

    return new Response('not found');
  }
};

