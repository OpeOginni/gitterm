import { auth } from "@gitterm/auth";
import { db, eq, and } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import type { Context } from "hono";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import env from "@gitterm/env/server";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract subdomain from Host header
 * Used for subdomain-based workspace routing in production
 */
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

// Lazy-load HTML error pages to avoid loading files in apps that don't use this router
let _errorPages: { unavailable: string; serverError: string; offline: string } | null = null;
function getErrorPages() {
	if (!_errorPages) {
		_errorPages = {
			unavailable: readFileSync(join(__dirname, 'errors', 'unavailable.html'), 'utf-8'),
			serverError: readFileSync(join(__dirname, 'errors', 'error.html'), 'utf-8'),
			offline: readFileSync(join(__dirname, 'errors', 'offline.html'), 'utf-8'),
		};
	}
	return _errorPages;
}

// Helper to return HTML error responses
function htmlError(c: Context, type: 'unavailable' | 'serverError' | 'offline', status: ContentfulStatusCode) {
	return c.html(getErrorPages()[type], status);
}

export const proxyResolverRouter = async (c: Context) => {
	console.log('[PROXY-RESOLVE] Request received');
	
	try {
        const internalKey = c.req.header('X-Internal-Key') || '';
        if (!internalKey) {
			console.log('[PROXY-RESOLVE] Missing internal key');
            return htmlError(c, 'unavailable', 401);
        }
        if (internalKey !== env.INTERNAL_API_KEY) {
			console.log('[PROXY-RESOLVE] Invalid internal key');
            return htmlError(c, 'unavailable', 401);
        }
		
		const subdomain = extractSubdomain(c.req.header('Host') || '');
		
		console.log('[PROXY-RESOLVE] Extracted subdomain:', { 
			subdomain, 
			host: c.req.header('Host')
		});
		
		if (!subdomain) {
			console.log('[PROXY-RESOLVE] No subdomain found');
		  return htmlError(c, 'unavailable', 400);
		}
	
		// Get session from cookies
		const session = await auth.api.getSession({
		  headers: c.req.raw.headers,
		});
	
		// Check workspace - only match active (running) workspaces
		// Subdomain is not unique, so we must filter by status to get the correct one
		const [ws] = await db
		  .select()
		  .from(workspace)
		  .where(and(
			eq(workspace.subdomain, subdomain),
			eq(workspace.status, 'running')
		  ))
		  .limit(1);
	
		if (!ws) {
            console.log('[PROXY-RESOLVE] Workspace not found for subdomain:', subdomain);
		  return htmlError(c, 'unavailable', 404);
		}
		
		console.log('[PROXY-RESOLVE] Workspace found:', { 
			id: ws.id, 
			subdomain: ws.subdomain, 
			tunnelType: ws.tunnelType,
			status: ws.status,
			userId: ws.userId
		});
	
		// Local tunnels: route via tunnel-proxy
		if (ws.tunnelType === "local") {
			// Server-only local tunnels skip auth (for API servers, etc.)
			if (ws.serverOnly) {
				console.log('[PROXY-RESOLVE] Local tunnel (server-only) - skipping auth:', { 
					subdomain: ws.subdomain,
					workspaceId: ws.id
				});
				return c.text("OK", 200, {
					"X-Tunnel-Type": "local",
					"X-Workspace-ID": ws.id,
					"X-Subdomain": ws.subdomain ?? "",
				});
			}

			// Non-server-only local tunnels require auth
			if (!session) {
				console.log('[PROXY-RESOLVE] Local tunnel requires auth - no session');
				return htmlError(c, 'unavailable', 401);
			}
			if (ws.userId !== session.user?.id) {
				console.log('[PROXY-RESOLVE] Local tunnel - user mismatch');
				return htmlError(c, 'unavailable', 403);
			}

			console.log('[PROXY-RESOLVE] Local tunnel authorized:', { 
				subdomain: ws.subdomain,
				workspaceId: ws.id,
				userId: session.user.id
			});
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
			return htmlError(c, 'serverError', 500);
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
		  return htmlError(c, 'unavailable', 401);
		}
	
		if (ws.userId !== session.user?.id) {
		  return htmlError(c, 'unavailable', 403);
		}
	
		if (!ws.backendUrl) {
		  return htmlError(c, 'serverError', 500);
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
		return htmlError(c, 'serverError', 500);
	  }
}
