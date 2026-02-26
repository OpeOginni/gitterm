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
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
      <Skeleton className="mb-2 h-5 w-40 bg-white/[0.04]" />
      <Skeleton className="h-4 w-72 bg-white/[0.04]" />
      <div className="mt-6 flex items-center justify-center py-4">
        <Skeleton className="h-6 w-6 bg-white/[0.04]" />
      </div>
    </div>
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
      {[
        {
          icon: GitlabIcon,
          name: "GitLab",
          description: "Connect GitLab for repository access and CI/CD",
          features: ["Private repository access", "Full CI/CD integration"],
        },
        {
          icon: BitbucketIcon,
          name: "Bitbucket",
          description: "Connect Bitbucket for repository management",
          features: ["Private repository access", "Jira integration support"],
        },
      ].map((item) => (
        <div
          key={item.name}
          className="rounded-2xl border border-dashed border-white/[0.06] bg-white/[0.01] p-6"
        >
          <div className="mb-3 flex items-center gap-2">
            <item.icon className="h-4 w-4 text-white/30" />
            <span className="text-sm font-medium text-white/50">
              {item.name}
            </span>
            <span className="ml-auto rounded-full border border-white/[0.08] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/30">
              Soon
            </span>
          </div>
          <p className="mb-4 text-sm text-white/30">{item.description}</p>
          <div className="space-y-2 text-sm text-white/25">
            {item.features.map((feat) => (
              <div key={feat} className="flex items-center gap-2">
                {feat.includes("CI/CD") || feat.includes("Jira") ? (
                  <GitBranch className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
                <span>{feat}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function IntegrationsPage() {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");

  const session = await authClient.getSession({
    fetchOptions: {
      headers: cookie ? { cookie } : {},
    },
  });

  if (!session.data?.user) {
    redirect("/login");
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Integrations"
        text="Connect external services to enhance your workspaces."
        className="mx-auto max-w-4xl"
      />
      <div className="mx-auto max-w-4xl space-y-6 pt-2">
        <Suspense fallback={null}>
          <IntegrationCallbackHandler />
        </Suspense>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium text-white/90">Available</h2>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              1
            </span>
          </div>
          <Suspense fallback={<GitHubConnectionSkeleton />}>
            <GitHubConnection />
          </Suspense>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium text-white/90">Coming Soon</h2>
          <ComingSoonCards />
        </section>
      </div>
    </DashboardShell>
  );
}
