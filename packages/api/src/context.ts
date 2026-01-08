import type { Context as HonoContext } from "hono";
import { auth } from "@gitterm/auth";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	
	// Extract internal API key for service-to-service auth
	const internalApiKey = context.req.raw.headers.get("x-internal-key");
	
	// Extract workspace JWT token from Authorization header
	const authHeader = context.req.raw.headers.get("authorization");
	const bearerToken = authHeader?.startsWith("Bearer ") 
		? authHeader.substring(7) 
		: undefined;

	const githubEvent = context.req.raw.headers.get("X-GitHub-Event");
	const githubInstallationTargetId = context.req.raw.headers.get("X-GitHub-Hook-Installation-Target-ID");
	const githubXHubSignature256 = context.req.raw.headers.get("x-hub-signature-256");
	const githubRawBody = await context.req.text();

	return {
		session,
		internalApiKey,
		bearerToken,
		githubEvent,
		githubInstallationTargetId,
		githubXHubSignature256,
		githubRawBody
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
