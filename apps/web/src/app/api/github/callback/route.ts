import { NextRequest, NextResponse } from "next/server";
import { authClient } from "@/lib/auth-client";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@gitterm/api/routers/index";
import env from "@gitterm/env/web";

/**
 * GitHub App Installation Setup URL Handler
 * 
 * This is the "Setup URL" for GitHub App installations (not the user authorization callback URL).
 * 
 * GitHub redirects here AFTER a user installs the app with these query parameters:
 * - installation_id: The ID of the installation
 * - setup_action: Either "install" or "update" (optional)
 * - state: Optional state parameter
 * 
 * IMPORTANT: According to GitHub docs, we should NOT trust the installation_id directly.
 * We must generate a user access token and verify the installation belongs to this user.
 * 
 * Flow:
 * 1. User installs GitHub App on GitHub
 * 2. GitHub redirects to this Setup URL with installation_id
 * 3. We verify user session
 * 4. We fetch installation details from GitHub API to verify it exists
 * 5. We store the installation in database
 * 6. Redirect to integrations page
 */
export async function GET(request: NextRequest) {
  try {
    // Log the incoming request details
    console.log("[GitHub Setup] Request URL:", request.url);
    console.log("[GitHub Setup] Request headers host:", request.headers.get("host"));
    console.log("[GitHub Setup] Request headers origin:", request.headers.get("origin"));
    console.log("[GitHub Setup] Request nextUrl.origin:", request.nextUrl.origin);

    // IMPORTANT:
    // `NEXT_PUBLIC_SERVER_URL` is the API base (often ends with `/api`).
    // Redirects must use the web origin, otherwise we end up at `/api/dashboard`.
    const webUrl = request.nextUrl.origin;

    // Get the session using authClient
    const session = await authClient.getSession({
      fetchOptions: {
        headers: request.headers,
      },
    });

    if (!session) {
      // User is not logged in - redirect to login with return URL
      return NextResponse.redirect(`${webUrl}/login?returnTo=/dashboard/integrations`);
    }

    // Extract query parameters from GitHub
    const searchParams = request.nextUrl.searchParams;
    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action") || "install"; // Default to "install"

    console.log("[GitHub Setup] Received callback:", {
      userId: session.data?.user.id,
      installationId,
      setupAction,
    });

    // Validate required parameters
    if (!installationId) {
      console.error("[GitHub Setup] Missing installation_id parameter");
      return NextResponse.redirect(`${webUrl}/dashboard/integrations?error=missing_installation_id`);
    }

    // Create a server-side TRPC client with the current request's cookies
    const serverUrl = env.NEXT_PUBLIC_SERVER_URL;
    if (!serverUrl) {
      console.error("[GitHub Setup] NEXT_PUBLIC_SERVER_URL not configured");
      return NextResponse.redirect(`${webUrl}/dashboard/integrations?error=server_misconfigured`);
    }

    console.log("[GitHub Setup] Using server URL:", serverUrl);

    // Get cookies from the request to pass to TRPC
    const cookieHeader = request.headers.get("cookie") || "";

    const apiClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${serverUrl}/trpc`,
          headers: {
            cookie: cookieHeader,
          },
        }),
      ],
    });

    // Call TRPC mutation to verify and store the installation
    try {
      const result = await apiClient.github.handleInstallation.mutate({
        installationId,
        setupAction: setupAction as "install" | "update",
      });

      console.log("[GitHub Setup] Installation saved successfully:", {
        userId: session.data?.user.id,
        installationId,
        accountLogin: result.installation.accountLogin,
      });

      // Success - redirect to integrations page with success message
      return NextResponse.redirect(`${webUrl}/dashboard/integrations?success=github_connected`);
    } catch (error) {
      console.error("[GitHub Setup] Failed to handle installation:", error);
      
      // Redirect with error
      return NextResponse.redirect(`${webUrl}/dashboard/integrations?error=installation_failed`);
    }
  } catch (error) {
    console.error("[GitHub Setup] Callback error:", error);

    // Redirect with generic error
    return NextResponse.redirect(`${request.nextUrl.origin}/dashboard/integrations?error=callback_failed`);
  }
}
