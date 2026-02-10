import { getSandbox } from "@cloudflare/sandbox";
import type { CloudSessionDestroyConfig } from "../../../compute";

export { Sandbox } from "@cloudflare/sandbox";


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
  },
};
