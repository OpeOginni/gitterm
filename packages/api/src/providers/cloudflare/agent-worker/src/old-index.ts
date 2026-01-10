// import { getSandbox, Sandbox } from "@cloudflare/sandbox";
// import { createOpencode } from "@cloudflare/sandbox/opencode";
// import { OpencodeClient, type BadRequestError, type NotFoundError } from "@opencode-ai/sdk";
// import type { SandboxConfig } from "../../../compute";

// export { Sandbox } from "@cloudflare/sandbox";

// /**
//  * Send callback to the listener with run results
//  */
// async function sendCallback(
//   callbackUrl: string,
//   callbackSecret: string,
//   payload: {
//     runId: string;
//     success: boolean;
//     sandboxId?: string;
//     commitSha?: string;
//     commitMessage?: string;
//     error?: string;
//     isComplete?: boolean;
//     durationSeconds?: number;
//   },
// ): Promise<void> {
//   try {
//     const controller = new AbortController();
//     const timeoutId = setTimeout(() => controller.abort(), 10_000);

//     const response = await fetch(callbackUrl, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${callbackSecret}`,
//       },
//       body: JSON.stringify(payload),
//       signal: controller.signal,
//     });

//     clearTimeout(timeoutId);

//     if (!response.ok) {
//       console.error(`Callback failed with status ${response.status}: ${await response.text()}`);
//     } else {
//       console.log("[Worker] Callback sent successfully");
//     }
//   } catch (error) {
//     console.error("Failed to send callback:", error);
//   }
// }

// /**
//  * Execute the agent run and return the result
//  */
// async function executeAgentRun(
//   config: SandboxConfig,
//   sandbox: Sandbox<unknown>,
//   callbackUrl?: string,
//   callbackSecret?: string,
//   runId?: string,
//   startTime?: number,
// ): Promise<{
//   success: boolean;
//   sandboxId: string;
//   commitHash?: string;
//   commitMessage?: string;
//   response?: any;
//   error?: string;
//   isComplete?: boolean;
// }> {
//   const {
//     userSandboxId,
//     repoOwner,
//     repoName,
//     branch,
//     gitAuthToken,
//     prompt,
//     featureListPath,
//     documentedProgressPath,
//     model,
//     apiKey,
//     iteration,
//   } = config;

//   const repoPath = `${repoOwner}/${repoName}`;

//   await sandbox.writeFile(
//     "/workspace/.git-credential-helper.sh",
//     `#!/bin/sh
// if [ "$1" = "get" ]; then
//     echo "protocol=https"
//     echo "host=github.com"
//     echo "username=x-access-token"
//     echo "password=${gitAuthToken}"
// fi
// `,
//   );

//   await sandbox.exec(
//     "git config --global credential.helper '/workspace/.git-credential-helper.sh'",
//   );

//   const repoUrl = `https://x-access-token:${gitAuthToken}@github.com/${repoPath}.git`;
//   const checkoutResult = await sandbox.gitCheckout(repoUrl, {
//     branch: branch,
//     targetDir: `/home/user/workspace/${repoName}`,
//   });

//   if (!checkoutResult.success) {
//     const errorMsg = `Failed to checkout repository ${repoPath} on branch ${branch}`;

//     if (callbackUrl && callbackSecret && runId && startTime) {
//       console.log("[Worker] Sending checkout error callback...");
//       await sendCallback(callbackUrl, callbackSecret, {
//         runId,
//         success: false,
//         sandboxId: userSandboxId,
//         error: errorMsg,
//         durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//       });
//     }

//     return {
//       success: false,
//       sandboxId: userSandboxId,
//       error: errorMsg,
//     };
//   }

//   const providerId = model.split("/")[0];
//   const specificModel = model.split("/")[1];

//   if (!providerId || !specificModel) {
//     const errorMsg = "Provider ID or specific model not found";

//     if (callbackUrl && callbackSecret && runId && startTime) {
//       await sendCallback(callbackUrl, callbackSecret, {
//         runId,
//         success: false,
//         sandboxId: userSandboxId,
//         error: errorMsg,
//         durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//       });
//     }

//     return {
//       success: false,
//       sandboxId: userSandboxId,
//       error: errorMsg,
//     };
//   }

//   const { client } = await createOpencode(sandbox, {
//     directory: `/home/user/workspace/${repoName}`,
//   });

//   console.log(`Setting auth for provider ${providerId}...`);
//   try {
//     await (client as OpencodeClient).auth.set({
//       path: { id: providerId },
//       body: { type: "api", key: apiKey },
//     });
//     console.log(`Auth set successfully for provider ${providerId}`);
//   } catch (error) {
//     console.error(`Failed to set auth:`, error);
//     const errorMsg = `Failed to set auth: ${error instanceof Error ? error.message : "Unknown error"}`;

//     if (callbackUrl && callbackSecret && runId && startTime) {
//       console.log("[Worker] Sending auth error callback...");
//       await sendCallback(callbackUrl, callbackSecret, {
//         runId,
//         success: false,
//         sandboxId: userSandboxId,
//         error: errorMsg,
//         durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//       });
//     }

//     return {
//       success: false,
//       sandboxId: userSandboxId,
//       error: errorMsg,
//     };
//   }

//   console.log("Creating session...");
//   const session = await (client as OpencodeClient).session.create({
//     body: {
//       title: `Agent Loop Iteration ${iteration}`,
//     },
//     query: { directory: `/home/user/workspace/${repoName}` },
//   });

//   if (session.error) {
//     console.error("Failed to create session:", session.error);
//     const errorMsg = `Failed to create session: ${JSON.stringify(session.error)}`;

//     if (callbackUrl && callbackSecret && runId && startTime) {
//       console.log("[Worker] Sending session creation error callback...");
//       await sendCallback(callbackUrl, callbackSecret, {
//         runId,
//         success: false,
//         sandboxId: userSandboxId,
//         error: errorMsg,
//         durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//       });
//     }

//     return {
//       success: false,
//       sandboxId: userSandboxId,
//       error: errorMsg,
//     };
//   }

//   console.log(`[Worker Log] Session created successfully: ${session.data.id}`);

//   const fullPrompt = `You are working on the repository at branch "${branch}". 

// CRITICAL CONSTRAINTS:
// 1. DO NOT checkout, switch, or create any branches. Stay on the current branch "${branch}" at all times.
// 2. Work on ONE feature from the plan file (@${featureListPath}) completely - do not start multiple features.
// 3. Make all necessary changes to complete the feature you choose.
// 4. Commit ALL your changes in a SINGLE commit with a clear, descriptive message.
// 5. Do NOT make partial commits or multiple commits - finish the feature entirely, then commit once.

// WORKFLOW:
// 1. Read the plan file (@${featureListPath})${documentedProgressPath ? ` and the progress file (@${documentedProgressPath})` : ""}.
// 2. Choose ONE incomplete feature of your choice from the plan.
// 3. Implement the entire feature completely.
// ${documentedProgressPath ? `4. Update the progress file (@${documentedProgressPath}) to document what you completed.` : ""}
// ${documentedProgressPath ? "5" : "4"}. Stage all changes: git add -A
// ${documentedProgressPath ? "6" : "5"}. Commit once with a descriptive message: git commit -m "feat: [description of what you implemented]"
// ${documentedProgressPath ? "7" : "6"}. If the plan is complete after implementing this feature, output <promise>COMPLETE</promise>.

// ${prompt ? `\nADDITIONAL INSTRUCTIONS:\n${prompt}` : ""}

// Remember: Complete one feature fully, commit once, stay on branch "${branch}".`;

//   const result = await (client as OpencodeClient).session.prompt({
//     path: { id: session.data.id },
//     body: {
//       model: { providerID: providerId, modelID: specificModel },
//       parts: [
//         {
//           type: "text",
//           text: fullPrompt,
//         },
//       ],
//     },
//   });

//   console.log("COMPLETED OPENCODE SESSION");

//   if (result.error?.data) {
//     const error = result.error;
//     let errorMsg = "Unknown error";

//     if ((error as NotFoundError).name === "NotFoundError") {
//       errorMsg = (error as NotFoundError).data.message;
//     } else if ((error as BadRequestError).errors?.length > 0) {
//       errorMsg = (error as BadRequestError).errors.map((error) => error.message).join(", ");
//     }

//     if (callbackUrl && callbackSecret && runId && startTime) {
//       console.log("[Worker] Sending prompt execution error callback...");
//       await sendCallback(callbackUrl, callbackSecret, {
//         runId,
//         success: false,
//         sandboxId: userSandboxId,
//         error: errorMsg,
//         durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//       });
//     }

//     return {
//       success: false,
//       sandboxId: userSandboxId,
//       error: errorMsg,
//     };
//   }

//   console.log("COMPLETED OPENCODE SESSION PROMPT");
//   const latestCommit = await sandbox.exec(
//     `cd /home/user/workspace/${repoName} && git log -1 --pretty=format:"%H %s"`,
//   );

//   if (latestCommit.exitCode !== 0) {
//     const errorMsg = `Failed to get latest commit: ${latestCommit.stderr || latestCommit.stdout}`;

//     if (callbackUrl && callbackSecret && runId && startTime) {
//       console.log("[Worker] Sending commit check error callback...");
//       await sendCallback(callbackUrl, callbackSecret, {
//         runId,
//         success: false,
//         sandboxId: userSandboxId,
//         error: errorMsg,
//         durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//       });
//     }

//     return {
//       success: false,
//       sandboxId: userSandboxId,
//       error: errorMsg,
//     };
//   }

//   const commitHash = latestCommit.stdout.split(" ")[0];
//   const commitMessage = latestCommit.stdout.split(" ").slice(1).join(" ");

//   if (callbackUrl && callbackSecret && runId && startTime) {
//     console.log("[Worker] Sending success callback...");
//     await sendCallback(callbackUrl, callbackSecret, {
//       runId,
//       success: true,
//       sandboxId: userSandboxId,
//       commitSha: commitHash,
//       commitMessage,
//       isComplete: true,
//       durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//     });
//     console.log("[Worker] Success callback sent");
//   }

//   console.log("RETURNING FROM OPENCODE SESSION LATEST COMMIT", latestCommit);
//   return {
//     success: true,
//     sandboxId: userSandboxId,
//     commitHash,
//     commitMessage,
//     response: result.data,
//     isComplete: true,
//   };
// }

// export default {
//   async fetch(request: Request, env: Env): Promise<Response> {
//     if (request.method !== "POST") {
//       return new Response("Not found", { status: 404 });
//     }

//     const authorization = request.headers.get("Authorization");
//     const token = authorization?.startsWith("Bearer ")
//       ? authorization.slice("Bearer ".length)
//       : undefined;

//     if (!authorization || !token || token !== env.INTERNAL_API_KEY) {
//       return Response.json(
//         {
//           error: "Unauthorized",
//           success: false,
//           message: "Unauthorized",
//         },
//         { status: 401 },
//       );
//     }

//     const config = await request.json<SandboxConfig>();
//     const startTime = Date.now();

//     // Keep keepAlive: true for long-running OpenCode sessions
//     // The alarm() handler in our extended Sandbox class will handle the keepAlive heartbeats
//     const sandbox = getSandbox(env.Sandbox, config.userSandboxId, {
//       // keepAlive: true,
//     });

//     try {
//       const result = await executeAgentRun(
//         config,
//         sandbox,
//         config.callbackUrl,
//         config.callbackSecret,
//         config.runId,
//         startTime,
//       );

//       return Response.json({
//         success: true,
//         message: "Run completed",
//         result,
//       });
//     } catch (error) {
//       console.error("Failed to execute agent run:", error);

//       // Send error callback if configured
//       if (config.callbackUrl && config.callbackSecret && config.runId) {
//         await sendCallback(config.callbackUrl, config.callbackSecret, {
//           runId: config.runId,
//           success: false,
//           sandboxId: config.userSandboxId,
//           error: error instanceof Error ? error.message : "Unknown error",
//           durationSeconds: Math.floor((Date.now() - startTime) / 1000),
//         });
//       }

//       return Response.json(
//         {
//           success: false,
//           error: error instanceof Error ? error.message : "Unknown error",
//         },
//         { status: 500 },
//       );
//     } finally {
//       await sandbox.destroy();
//     }
//   },
// };
