import { tool } from "@opencode-ai/plugin";

export default tool({
  description:
    "Call this tool AFTER you have committed your changes. It fetches the commit details and notifies the server. If you failed to complete the feature, call with success=false and provide an error message.",
  args: {
    success: tool.schema
      .boolean()
      .describe("Whether you successfully implemented and committed the feature"),
    error: tool.schema.string().optional().describe("If success=false, describe what went wrong"),
  },
  async execute(args, context) {
    let commitSha = "";
    let commitMessage = "";
    let actualSuccess = args.success;
    let errorMessage = args.error || "";

    if (args.success) {
      try {
        // Get the latest commit info
        const result = await Bun.$`git log -1 --pretty=format:"%H|%s"`.text();
        const cleanResult = result.replace(/"/g, "").trim();
        const [sha, ...messageParts] = cleanResult.split("|");
        const message = messageParts.join("|");

        if (!sha || sha.length !== 40) {
          actualSuccess = false;
          errorMessage = `Invalid commit SHA detected: ${sha}`;
        } else {
          commitSha = sha;
          commitMessage = message;
        }
      } catch (err) {
        actualSuccess = false;
        errorMessage = `Failed to get commit info: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    await fetch(process.env.AGENT_CALLBACK_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AGENT_CALLBACK_SECRET!}`,
      },
      body: JSON.stringify({
        runId: process.env.RUN_ID!,
        sandboxId: process.env.SANDBOX_ID!,
        success: actualSuccess,
        commitSha,
        commitMessage,
        error: errorMessage,
      }),
    });

    if (actualSuccess) {
      return `Callback sent successfully. Commit: ${commitSha.substring(0, 7)} - ${commitMessage}`;
    } else {
      return `Callback sent with failure. Reason: ${errorMessage}`;
    }
  },
}) as ReturnType<typeof tool>;
