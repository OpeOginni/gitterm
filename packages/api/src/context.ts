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
	const workspaceToken = authHeader?.startsWith("Bearer ") 
		? authHeader.substring(7) 
		: undefined;


	return {
		session,
		internalApiKey,
		workspaceToken,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
