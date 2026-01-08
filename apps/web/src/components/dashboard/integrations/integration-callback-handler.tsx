"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Client component that handles URL search params for success/error toasts
 * after GitHub OAuth callback redirects
 */
export function IntegrationCallbackHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "github_connected") {
      toast.success("GitHub App connected successfully!", {
        description: "You can now use git operations in your workspaces",
      });
      window.history.replaceState({}, "", "/dashboard/integrations");
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
      window.history.replaceState({}, "", "/dashboard/integrations");
    }
  }, [searchParams]);

  // This component doesn't render anything visible
  return null;
}
