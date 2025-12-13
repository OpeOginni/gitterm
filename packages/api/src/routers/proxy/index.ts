import { auth } from "@gitpad/auth";
import { db, eq } from "@gitpad/db";
import { workspace } from "@gitpad/db/schema/workspace";
import type { Context } from "hono";

function extractSubdomain(host: string): string {
	const hostname = host.split(':')[0];
	if (!hostname) {
		return '';
	}
	const parts = hostname.split('.');
	if (parts.length > 2) {
	  return parts[0] ?? '';
	}
	return '';
  }

export const proxyResolverRouter = async (c: Context) => {
	console.log('Proxy resolve request received');
	try {
        const internalKey = c.req.header('X-Internal-Key') || '';
        if (!internalKey) {
            return c.text('Unauthorized', 401);
        }
        if (internalKey !== process.env.INTERNAL_API_KEY) {
            return c.text('Unauthorized', 401);
        }
		const host = c.req.header('Host') || '';
		const subdomain = extractSubdomain(host);
		
		if (!subdomain) {
		  return c.text('Bad Request', 400);
		}
	
		// Get session from cookies
		const session = await auth.api.getSession({
		  headers: c.req.raw.headers,
		});
	
    
		// Check workspace
		const [ws] = await db
		  .select()
		  .from(workspace)
		  .where(eq(workspace.subdomain, subdomain))
		  .limit(1);
	
		if (!ws) {
            console.log('Looking for subdomain:', subdomain);
            console.log('Workspace not found');
		  return c.text('Not Found', 404);
		}
	
		// Local tunnels: route via tunnel-proxy (still requires auth)
		if (ws.tunnelType === "local") {
			if (!session) {
				return c.text("Unauthorized", 401);
			}
			if (ws.userId !== session.user?.id) {
				return c.text("Forbidden", 403);
			}

			return c.text("OK", 200, {
				"X-Tunnel-Type": "local",
				"X-Workspace-ID": ws.id,
				"X-User-ID": session.user.id,
				"X-Subdomain": ws.subdomain ?? "",
			});
		}

		// Server-only workspaces skip auth
		if (ws.serverOnly) {
		  if (!ws.backendUrl) {
			return c.text('Internal Server Error', 500);
		  }
          const backendUrl = new URL(ws.backendUrl);

		  return c.text('OK', 200, {
            'X-Upstream-URL': ws.backendUrl,
			'X-Container-Host': backendUrl.hostname,
            'X-Container-Port': backendUrl.port,
		  });
		}
	
		// Validate auth for non-server-only
		if (!session) {
		  return c.text('Unauthorized', 401);
		}
	
		if (ws.userId !== session.user?.id) {
		  return c.text('Forbidden', 403);
		}
	
		if (!ws.backendUrl) {
		  return c.text('Internal Server Error', 500);
		}
	
        const backendUrl = new URL(ws.backendUrl);
		return c.text('OK', 200, {
          'X-Upstream-URL': ws.backendUrl,
		  'X-Container-Host': backendUrl.hostname,
          'X-Container-Port': backendUrl.port,
		  'X-User-ID': session.user.id,
		  'X-Tunnel-Type': ws.tunnelType,
		});
		
	  } catch (error) {
		console.error('Auth resolve error:', error);
		return c.text('Internal Server Error', 500);
	  }
}