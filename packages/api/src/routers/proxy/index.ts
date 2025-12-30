import { auth } from "@gitterm/auth";
import { db, eq, and } from "@gitterm/db";
import { workspace } from "@gitterm/db/schema/workspace";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import env from "@gitterm/env/server";
import { extractWorkspaceSubdomain } from "../../utils/routing";

// Inlined error page HTML templates (to work in bundled builds)
const UNAVAILABLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Unavailable - GitTerm</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --background: #0d0d0d;
      --foreground: #eaeaea;
      --muted: #8a8a8a;
      --border: #2a2a2a;
      --primary: #eaeaea;
      --primary-foreground: #0d0d0d;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: var(--background);
      color: var(--foreground);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container { max-width: 480px; width: 100%; text-align: center; }
    .terminal {
      background: #1a1a1a;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .terminal-header {
      background: #2a2a2a;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .terminal-dot { width: 12px; height: 12px; border-radius: 50%; }
    .terminal-dot.red { background: rgba(239, 68, 68, 0.8); }
    .terminal-dot.yellow { background: rgba(234, 179, 8, 0.8); }
    .terminal-dot.green { background: rgba(34, 197, 94, 0.8); }
    .terminal-body {
      padding: 24px;
      font-family: 'Space Mono', monospace;
      font-size: 14px;
      color: #a0a0a0;
      text-align: left;
    }
    .terminal-line { margin-bottom: 8px; opacity: 0.9; }
    .terminal-prompt { color: #22c55e; }
    .terminal-error { color: #ef4444; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; letter-spacing: -0.025em; }
    p { color: var(--muted); font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--primary);
      color: var(--primary-foreground);
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .button:hover { opacity: 0.9; }
    .button svg { width: 16px; height: 16px; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); width: 100%; }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
    }
    .logo:hover { color: var(--foreground); }
    .logo svg { width: 20px; height: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="terminal">
      <div class="terminal-header">
        <div class="terminal-dot red"></div>
        <div class="terminal-dot yellow"></div>
        <div class="terminal-dot green"></div>
      </div>
      <div class="terminal-body">
        <div class="terminal-line"><span class="terminal-prompt">$</span> curl workspace.gitterm.dev</div>
        <div class="terminal-line"><span class="terminal-error">error:</span> workspace unavailable</div>
        <div class="terminal-line">_</div>
      </div>
    </div>
    <h1>Workspace Unavailable</h1>
    <p>This workspace doesn't exist, is offline, or you don't have permission to access it.</p>
    <a href="/" class="button">
      Go to GitTerm
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
    </a>
    <div class="footer">
      <a href="/" class="logo">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        GitTerm
      </a>
    </div>
  </div>
</body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Something Went Wrong - GitTerm</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --background: #0d0d0d;
      --foreground: #eaeaea;
      --muted: #8a8a8a;
      --border: #2a2a2a;
      --primary: #eaeaea;
      --primary-foreground: #0d0d0d;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: var(--background);
      color: var(--foreground);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container { max-width: 480px; width: 100%; text-align: center; }
    .terminal {
      background: #1a1a1a;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .terminal-header {
      background: #2a2a2a;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .terminal-dot { width: 12px; height: 12px; border-radius: 50%; }
    .terminal-dot.red { background: rgba(239, 68, 68, 0.8); }
    .terminal-dot.yellow { background: rgba(234, 179, 8, 0.8); }
    .terminal-dot.green { background: rgba(34, 197, 94, 0.8); }
    .terminal-body {
      padding: 24px;
      font-family: 'Space Mono', monospace;
      font-size: 14px;
      color: #a0a0a0;
      text-align: left;
    }
    .terminal-line { margin-bottom: 8px; opacity: 0.9; }
    .terminal-prompt { color: #22c55e; }
    .terminal-error { color: #ef4444; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; letter-spacing: -0.025em; }
    p { color: var(--muted); font-size: 16px; line-height: 1.6; margin-bottom: 24px; }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--primary);
      color: var(--primary-foreground);
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .button:hover { opacity: 0.9; }
    .button svg { width: 16px; height: 16px; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); width: 100%; }
    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
    }
    .logo:hover { color: var(--foreground); }
    .logo svg { width: 20px; height: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="terminal">
      <div class="terminal-header">
        <div class="terminal-dot red"></div>
        <div class="terminal-dot yellow"></div>
        <div class="terminal-dot green"></div>
      </div>
      <div class="terminal-body">
        <div class="terminal-line"><span class="terminal-prompt">$</span> gitterm connect</div>
        <div class="terminal-line"><span class="terminal-error">error:</span> internal server error</div>
        <div class="terminal-line">retrying in 5s...</div>
      </div>
    </div>
    <h1>Something Went Wrong</h1>
    <p>We're having trouble connecting to this workspace. Please try again in a moment.</p>
    <a href="javascript:location.reload()" class="button">
      Try Again
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    </a>
    <div class="footer">
      <a href="/" class="logo">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        GitTerm
      </a>
    </div>
  </div>
</body>
</html>`;

// Return HTML error page for user-facing errors
function htmlError(c: Context, type: 'unavailable' | 'error', status: ContentfulStatusCode) {
	const html = type === 'unavailable' ? UNAVAILABLE_HTML : ERROR_HTML;
	return c.html(html, status);
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
		
		// Extract subdomain from path (for path-based routing) or host (for subdomain routing)
		const originalUri = c.req.header('X-Original-URI') || c.req.path;
		const routingMode = c.req.header('X-Routing-Mode') || env.ROUTING_MODE;
		const host = c.req.header('Host') || '';
		
		const subdomain = extractWorkspaceSubdomain(host, originalUri, {
			"x-subdomain": c.req.header('X-Subdomain'),
			"x-routing-mode": routingMode,
		});
		
		console.log('[PROXY-RESOLVE] Extracted subdomain:', { 
			subdomain, 
			host,
			originalUri,
			routingMode,
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
			return htmlError(c, 'error', 500);
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
		  return htmlError(c, 'error', 500);
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
		return htmlError(c, 'error', 500);
	  }
}
