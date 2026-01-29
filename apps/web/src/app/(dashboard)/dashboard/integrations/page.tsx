import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { GitHubConnection } from "@/components/dashboard/github-connection";
import { IntegrationCallbackHandler } from "@/components/dashboard/integrations/integration-callback-handler";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitBranch, Lock } from "lucide-react";
import { authClient } from "@/lib/auth-client";

function GitHubConnectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48 mb-2" />
        <Skeleton className="h-4 w-96" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center py-8">
          <Skeleton className="h-6 w-6" />
        </div>
      </CardContent>
    </Card>
  );
}

function GitlabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

function BitbucketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
    </svg>
  );
}

function ComingSoonCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="border-dashed border-border/40 bg-card/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitlabIcon className="h-4 w-4 text-muted-foreground" />
            GitLab
            <Badge
              variant="outline"
              className="ml-auto text-xs border-border/50 text-muted-foreground"
            >
              Soon
            </Badge>
          </CardTitle>
          <CardDescription className="text-sm">
            Connect GitLab for repository access and CI/CD
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              <span>Private repository access</span>
            </div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              <span>Full CI/CD integration</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed border-border/40 bg-card/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BitbucketIcon className="h-4 w-4 text-muted-foreground" />
            Bitbucket
            <Badge
              variant="outline"
              className="ml-auto text-xs border-border/50 text-muted-foreground"
            >
              Soon
            </Badge>
          </CardTitle>
          <CardDescription className="text-sm">
            Connect Bitbucket for repository management
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              <span>Private repository access</span>
            </div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              <span>Jira integration support</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function IntegrationsPage() {
  const session = await authClient.getSession({
    fetchOptions: { headers: await headers() },
  });

  if (!session.data?.user) {
    redirect("/login");
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Integrations"
        text="Connect external services to enhance your workspace capabilities."
        className="mx-auto max-w-4xl"
      />
      <div className="pt-8">
        <div className="grid gap-8 mx-auto max-w-4xl">
          {/* Client component for handling URL params and showing toasts */}
          <Suspense fallback={null}>
            <IntegrationCallbackHandler />
          </Suspense>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-medium">Available</h2>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">1</Badge>
            </div>
            <Suspense fallback={<GitHubConnectionSkeleton />}>
              <GitHubConnection />
            </Suspense>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-medium">Coming Soon</h2>
            <ComingSoonCards />
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
