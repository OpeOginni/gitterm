"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { GitHubConnection } from "@/components/dashboard/github-connection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, AlertCircle, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // Handle success/error messages from GitHub callback
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "github_connected") {
      toast.success("GitHub App connected successfully!", {
        description: "You can now use git operations in your workspaces",
      });
      // Clear the query parameter
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
      // Clear the query parameter
      window.history.replaceState({}, "", "/dashboard/integrations");
    }
  }, [searchParams]);

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Integrations"
        text="Connect external services to enhance your workspace capabilities"
      />
      
      <div className="grid gap-6 max-w-4xl">
        {/* Active Integrations */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Available Integrations</h3>
            <Badge variant="secondary" className="text-xs">1</Badge>
          </div>
          <GitHubConnection />
        </div>

        {/* Coming Soon Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Coming Soon</h3>
            <Badge variant="outline" className="text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              In Development
            </Badge>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            {/* GitLab */}
            <Card className="border-dashed opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-1.5 bg-orange-500/10 rounded-md">
                    <GitBranch className="h-4 w-4 text-orange-500" />
                  </div>
                  GitLab Integration
                  <Badge variant="outline" className="text-xs ml-auto">Soon</Badge>
                </CardTitle>
                <CardDescription className="text-sm">
                  Connect your GitLab account for git operations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Secure access to private repositories</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <GitBranch className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Full CI/CD pipeline integration</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bitbucket */}
            <Card className="border-dashed opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="p-1.5 bg-blue-500/10 rounded-md">
                    <GitBranch className="h-4 w-4 text-blue-500" />
                  </div>
                  Bitbucket Integration
                  <Badge variant="outline" className="text-xs ml-auto">Soon</Badge>
                </CardTitle>
                <CardDescription className="text-sm">
                  Connect your Bitbucket account for git operations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Access to private repositories</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <GitBranch className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Jira integration support</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Info Card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-sm">Need help with integrations?</p>
                <p className="text-sm text-muted-foreground">
                  Check out our documentation or contact support if you're having trouble connecting your accounts.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
