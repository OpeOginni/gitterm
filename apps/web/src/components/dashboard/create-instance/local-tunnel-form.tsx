"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getWorkspaceDisplayUrl } from "@/lib/utils";
import { isBillingEnabled } from "@gitterm/env/web";
import type { Route } from "next";
import { AgentTypeSelect } from "./agent-type-select";
import type { AgentType, SubdomainPermissions } from "./types";

interface LocalTunnelFormProps {
  subdomain: string;
  onSubdomainChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  selectedAgentTypeId: string;
  onAgentTypeChange: (value: string) => void;
  agentTypes: AgentType[];
  subdomainPermissions: SubdomainPermissions | undefined;
}

export function LocalTunnelForm({
  subdomain,
  onSubdomainChange,
  name,
  onNameChange,
  selectedAgentTypeId,
  onAgentTypeChange,
  agentTypes,
  subdomainPermissions,
}: LocalTunnelFormProps) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="subdomain" className="text-sm font-medium">Subdomain</Label>
        <Input
          id="subdomain"
          placeholder="my-app"
          value={subdomain}
          onChange={(e) => onSubdomainChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          className="bg-secondary/30 border-border/50 focus:border-accent"
          disabled={!subdomainPermissions?.canUseCustomTunnelSubdomain}
        />
        <p className="text-xs text-muted-foreground">
          {subdomainPermissions?.canUseCustomTunnelSubdomain ? (
            <>Your tunnel will be available at: <span className="font-mono text-primary">{getWorkspaceDisplayUrl(subdomain || "my-app")}</span></>
          ) : (
            <span className="flex items-center gap-1 flex-wrap">
              A subdomain will be generated automatically.
              {isBillingEnabled() && (
                <Link
                  href={"/pricing" as Route}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                >
                  <Sparkles className="h-3 w-3" />
                  Upgrade for custom subdomains
                </Link>
              )}
            </span>
          )}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="local-name" className="text-sm font-medium">Name (optional)</Label>
        <Input
          id="local-name"
          placeholder="My Local App"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="bg-secondary/30 border-border/50 focus:border-accent"
        />
      </div>
      <AgentTypeSelect
        value={selectedAgentTypeId}
        onChange={onAgentTypeChange}
        agentTypes={agentTypes}
        description="Choose which agent you are going to run in your local environment"
      />
    </>
  );
}
