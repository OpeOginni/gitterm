"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { parseGitHubRepositoryInput } from "../create-instance/github-repository-utils";
import type { ModelCredential } from "../model-credentials/types";
import { connectionRefs, modelProblem, suggestModel, type Platform } from "./config";
import { ConfigStepBody } from "./config-step";
import { ModelStepBody } from "./model-step";
import { RepositoryStepBody } from "./repository-step";
import { Step, StepProgress, type StepInfo } from "./step";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
];

export function BotSetup() {
  const { data: catalog, isLoading: isLoadingCatalog } = useQuery(
    trpc.integrations.list.queryOptions(),
  );
  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    trpc.modelCredentials.listProviders.queryOptions(),
  );
  const { data: credentialsData, isLoading: isLoadingCredentials } = useQuery(
    trpc.modelCredentials.listMyCredentials.queryOptions(),
  );
  const isEnabled = (key: string) =>
    catalog?.some((integration) => integration.key === key && integration.enabled) === true;
  const githubEnabled = isEnabled("github");
  const toolsEnabled = isEnabled("mcp") || isEnabled("executor");
  const { data: connections = [] } = useQuery({
    ...trpc.integrations.connections.list.queryOptions(),
    enabled: toolsEnabled,
  });

  // Model
  const credentials: ModelCredential[] = useMemo(
    () => credentialsData?.credentials ?? [],
    [credentialsData?.credentials],
  );
  const [credentialId, setCredentialId] = useState<string>();
  const [modelInput, setModelInput] = useState<string | null>(null);
  const active = credentials.filter((credential) => credential.isActive);
  const firstProvider = active[0]?.logicalProviderKey;
  const credential =
    active.find((candidate) => candidate.id === credentialId) ??
    active.find(
      (candidate) => candidate.logicalProviderKey === firstProvider && candidate.isDefault,
    ) ??
    active[0];
  const model = modelInput ?? suggestModel(credential?.logicalProviderKey);
  const modelIssue = credential ? modelProblem(model, credential.logicalProviderKey) : null;
  const modelDone = !!credential && !modelIssue;

  // Repository
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const repository = parseGitHubRepositoryInput(repoUrl);
  const repoDone = !!repository;

  // Tools
  const tools = connections.filter(
    (connection) =>
      (connection.integration === "mcp" || connection.integration === "executor") &&
      connection.status === "connected",
  );
  const [toolIds, setToolIds] = useState<string[]>([]);
  const selectedTools = tools.filter((tool) => toolIds.includes(tool.id));

  const [platform, setPlatform] = useState<Platform>("slack");

  const [token, setToken] = useState<string | null>(null);

  const modelStep: StepInfo = {
    id: "bot-model",
    title: "Model",
    state: modelDone ? "done" : "todo",
  };
  const repoStep: StepInfo = {
    id: "bot-repository",
    title: "Repository",
    state: repoDone ? "done" : "todo",
  };
  const toolsStep: StepInfo | null = toolsEnabled
    ? { id: "bot-tools", title: "Tools", state: selectedTools.length ? "done" : "optional" }
    : null;
  const platformStep: StepInfo = { id: "bot-platform", title: "Platform", state: "done" };
  const configStep: StepInfo = {
    id: "bot-config",
    title: "Config",
    state: token ? "done" : "todo",
  };
  const steps = [modelStep, repoStep, ...(toolsStep ? [toolsStep] : []), platformStep, configStep];
  const number = (step: StepInfo) => steps.indexOf(step) + 1;

  const modelHint = !credential
    ? "Add a model credential."
    : modelIssue
      ? "Enter a valid model ID."
      : `Runs ${model.trim()} with ${credential.providerDisplayName} · ${credential.label}.`;
  const missing = [!modelDone && "a model", !repoDone && "a repository"].filter(Boolean);

  if (isLoadingCatalog) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-80 bg-fill" />
        <Skeleton className="h-40 w-full bg-fill" />
        <Skeleton className="h-40 w-full bg-fill" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepProgress steps={steps} />

      <Step step={modelStep} number={number(modelStep)} hint={modelHint}>
        <ModelStepBody
          isLoading={isLoadingCredentials || isLoadingProviders}
          providers={providersData?.providers ?? []}
          credentials={credentials}
          credential={credential}
          onCredentialChange={(id) => {
            setCredentialId(id);
            setModelInput(null);
          }}
          model={model}
          onModelChange={setModelInput}
          modelProblem={modelIssue}
        />
      </Step>

      <Step
        step={repoStep}
        number={number(repoStep)}
        hint={
          repository
            ? `The agent works in ${repository.fullName}${branch ? ` on ${branch}` : ""}.`
            : "Pick a repository or paste its URL."
        }
      >
        <RepositoryStepBody
          githubEnabled={githubEnabled}
          repoUrl={repoUrl}
          branch={branch}
          onRepoUrlChange={setRepoUrl}
          onBranchChange={setBranch}
        />
      </Step>

      {toolsStep ? (
        <Step
          step={toolsStep}
          number={number(toolsStep)}
          hint="MCP servers the agent can use. GitHub is attached automatically."
        >
          {tools.length === 0 ? (
            <p className="text-[13px] text-fg-3">
              No connected tools.{" "}
              <Link
                href={"/dashboard/integrations" as Route}
                className="text-fg-2 underline underline-offset-2 hover:text-fg"
              >
                Add one in Integrations
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-line">
                {tools.map((tool) => (
                  <label
                    key={tool.id}
                    className="flex cursor-pointer items-center gap-3 py-2.5 text-[13px]"
                  >
                    <Checkbox
                      checked={toolIds.includes(tool.id)}
                      onCheckedChange={(checked) =>
                        setToolIds((ids) =>
                          checked === true ? [...ids, tool.id] : ids.filter((id) => id !== tool.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-fg">{tool.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-4">
                      {tool.integration === "executor" ? "Executor" : "MCP"}
                    </span>
                  </label>
                ))}
              </div>
              <Link
                href={"/dashboard/integrations" as Route}
                className="inline-block text-xs text-fg-3 underline underline-offset-2 hover:text-fg"
              >
                Manage connections
              </Link>
            </div>
          )}
        </Step>
      ) : null}

      <Step
        step={platformStep}
        number={number(platformStep)}
        hint="Where people talk to the agent."
      >
        <div className="inline-flex rounded-lg border border-line bg-fill p-1" role="radiogroup">
          {PLATFORMS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={platform === option.value}
              onClick={() => setPlatform(option.value)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm transition-colors",
                platform === option.value ? "bg-fill-2 text-fg" : "text-fg-3 hover:text-fg-2",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Step>

      <Step
        step={configStep}
        number={number(configStep)}
        hint="A token for the bot, your .env, and how to run it."
      >
        <ConfigStepBody
          token={token}
          onToken={setToken}
          missing={missing.length ? `Add ${missing.join(" and ")} first.` : null}
          config={{
            platform,
            repo: `${repository?.normalizedUrl ?? ""}${branch ? `#${branch}` : ""}`,
            model: model.trim(),
            credential: credential && !credential.isDefault ? credential.label : undefined,
            connections: connectionRefs(selectedTools, connections),
          }}
        />
      </Step>
    </div>
  );
}
