"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
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
import { ComputeStepBody, type ComputeOption } from "./compute-step";
import { RepositoryStepBody, type GitHubAccess } from "./repository-step";
import { SetupSummary, Step, type StepInfo } from "./step";

const PLATFORMS: { value: Platform; label: string; description: string; logo: string }[] = [
  {
    value: "slack",
    label: "Slack",
    description: "Mention it in a channel or DM",
    logo: "/slack.svg",
  },
  {
    value: "discord",
    label: "Discord",
    description: "Mention it in a server channel",
    logo: "/discord.svg",
  },
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
  const [githubAccess, setGithubAccess] = useState<GitHubAccess>("connection");
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

  // Compute: one entry per provider type (AWS has a row per region).
  const { data: providersList } = useQuery(
    trpc.workspace.listCloudProviders.queryOptions({ cloudOnly: true }),
  );
  const computeOptions: ComputeOption[] = [
    ...new Map(
      (providersList?.cloudProviders ?? []).map((entry) => [
        entry.providerKey,
        { key: entry.providerKey, name: entry.providerKey === "aws" ? "AWS" : entry.name },
      ]),
    ).values(),
  ];
  const { data: defaultProviderData } = useQuery(trpc.user.getDefaultCloudProvider.queryOptions());
  const defaultKey =
    providersList?.cloudProviders.find((entry) => entry.id === defaultProviderData?.cloudProviderId)
      ?.providerKey ?? null;
  const [providerChoice, setProviderChoice] = useState<string | null>(null);
  const selectedProvider = providerChoice ?? defaultKey;
  // Only a provider other than the default is written out; the default may change later.
  const provider = selectedProvider !== defaultKey ? selectedProvider : null;

  const [platform, setPlatform] = useState<Platform | null>(null);

  const [token, setToken] = useState<string | null>(null);

  const modelStep: StepInfo = {
    id: "bot-model",
    title: "Model",
    state: modelDone ? "done" : "todo",
    summary: modelDone ? model.trim() : credential ? "Enter a model ID" : "Add a model credential",
  };
  const repoStep: StepInfo = {
    id: "bot-repository",
    title: "Repository",
    state: repoDone ? "done" : "todo",
    summary: repository
      ? `${repository.fullName}${branch ? `#${branch}` : ""}`
      : "Pick a repository",
  };
  const toolsStep: StepInfo | null = toolsEnabled
    ? {
        id: "bot-tools",
        title: "Tools",
        state: selectedTools.length ? "done" : "optional",
        summary: selectedTools.length
          ? selectedTools.map((tool) => tool.name).join(", ")
          : "Optional",
      }
    : null;
  const computeStep: StepInfo | null =
    computeOptions.length > 1
      ? {
          id: "bot-compute",
          title: "Compute",
          state: "optional",
          summary:
            computeOptions.find((option) => option.key === selectedProvider)?.name ?? "Default",
        }
      : null;
  const platformStep: StepInfo = {
    id: "bot-platform",
    title: "Platform",
    state: platform ? "done" : "todo",
    summary: platform
      ? PLATFORMS.find((option) => option.value === platform)?.label
      : "Slack or Discord",
  };
  const configStep: StepInfo = {
    id: "bot-config",
    title: "Config",
    state: token ? "done" : "todo",
    summary: token ? "Token created" : "Create a bot token",
  };
  const steps = [
    modelStep,
    repoStep,
    ...(computeStep ? [computeStep] : []),
    ...(toolsStep ? [toolsStep] : []),
    platformStep,
    configStep,
  ];
  const number = (step: StepInfo) => steps.indexOf(step) + 1;

  const modelHint = !credential
    ? "Add a model credential."
    : modelIssue
      ? "Enter a valid model ID."
      : `Runs ${model.trim()} with ${credential.providerDisplayName} · ${credential.label}.`;
  const missing = [
    !modelDone && "a model",
    !repoDone && "a repository",
    !platform && "a platform",
  ].filter((item): item is string => !!item);

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
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <aside className="lg:sticky lg:top-8 lg:order-last">
        <SetupSummary steps={steps} />
      </aside>

      <div className="space-y-4">
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
            access={githubAccess}
            onAccessChange={setGithubAccess}
            githubEnabled={githubEnabled}
            repoUrl={repoUrl}
            branch={branch}
            onRepoUrlChange={setRepoUrl}
            onBranchChange={setBranch}
          />
        </Step>

        {computeStep ? (
          <Step
            step={computeStep}
            number={number(computeStep)}
            hint="Where new sandboxes run. Regions and sizes use the provider's defaults."
          >
            <ComputeStepBody
              options={computeOptions}
              selected={selectedProvider}
              defaultKey={defaultKey}
              onSelect={setProviderChoice}
            />
          </Step>
        ) : null}

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
                            checked === true
                              ? [...ids, tool.id]
                              : ids.filter((id) => id !== tool.id),
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
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
            {PLATFORMS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={platform === option.value}
                onClick={() => setPlatform(option.value)}
                className={cn(
                  "flex items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors",
                  platform === option.value
                    ? "border-primary/60 bg-fill"
                    : "border-line hover:border-fg-4 hover:bg-fill",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-fill-2">
                  <Image src={option.logo} alt="" width={20} height={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-fg">{option.label}</span>
                  <span className="block truncate text-[13px] text-fg-3">{option.description}</span>
                </span>
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    platform === option.value ? "border-primary" : "border-fg-4",
                  )}
                >
                  {platform === option.value ? (
                    <span className="size-2 rounded-full bg-primary" />
                  ) : null}
                </span>
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
            missing={
              missing.length
                ? `Add ${new Intl.ListFormat("en", { type: "conjunction" }).format(missing)} first.`
                : null
            }
            config={{
              // Token creation waits for a platform (see `missing`), so the fallback is never shown.
              platform: platform ?? "slack",
              repo: `${repository?.normalizedUrl ?? ""}${branch ? `#${branch}` : ""}`,
              model: model.trim(),
              credential: credential && !credential.isDefault ? credential.label : undefined,
              connections: connectionRefs(selectedTools, connections),
              githubToken: githubAccess === "token",
              provider: provider ?? undefined,
            }}
          />
        </Step>
      </div>
    </div>
  );
}
