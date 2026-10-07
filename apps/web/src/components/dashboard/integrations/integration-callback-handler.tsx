"use client";

import { useEffect, useRef } from "react";
import { trackIntegrationAdded } from "@/lib/analytics";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import { GITHUB_RETURN_TO_KEY } from "@/components/dashboard/github-connection";

/**
 * Client component that handles URL search params for success/error toasts
 * after GitHub OAuth callback redirects
 */
export function IntegrationCallbackHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const handledCallback = useRef(false);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (!success && !error) return;
    if (handledCallback.current) return;
    handledCallback.current = true;

    // A page that started the install (e.g. bot setup) asked to get the user back.
    const returnTo = sessionStorage.getItem(GITHUB_RETURN_TO_KEY);
    sessionStorage.removeItem(GITHUB_RETURN_TO_KEY);
    const leave = () =>
      returnTo?.startsWith("/dashboard/")
        ? router.replace(returnTo as Route)
        : window.history.replaceState({}, "", "/dashboard/integrations");

    if (success === "github_connected") {
      trackIntegrationAdded("github");
      toast.success("GitHub App connected successfully!", {
        description: "You can now use git operations in your workspaces",
      });
      leave();
    } else if (error) {
      const errorMessages: Record<string, string> = {
        missing_installation_id: "GitHub callback missing installation ID",
        invalid_setup_action: "Invalid setup action from GitHub",
        installation_failed: "Failed to save GitHub installation",
        callback_failed: "GitHub callback failed",
      };
      toast.error(errorMessages[error] || "Failed to connect GitHub App", {
        description: "Please try again or contact support if the issue persists",
      });
      leave();
    }
  }, [router, searchParams]);

  // This component doesn't render anything visible
  return null;
}
