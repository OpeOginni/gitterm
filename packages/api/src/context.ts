import type { Context as HonoContext } from "hono";
import { auth } from "@gitpad/auth";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	
	// Extract internal API key for service-to-service auth
	const internalApiKey = context.req.raw.headers.get("x-internal-key");
	
	return {
		session,
		internalApiKey,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
