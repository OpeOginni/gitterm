"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BotSettings } from "@gitterm/schema";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { parseGitHubRepositoryInput } from "../create-instance/github-repository-utils";
import type { ModelCredential } from "../model-credentials/types";
import { BehaviorStepBody, type BotBehavior } from "./behavior-step";
import { connectionRefs, modelProblem, suggestModel, type Platform } from "./config";
import { DeployInstructions } from "./config-step";
import { ModelStepBody } from "./model-step";
import { ComputeStepBody, type ComputeOption } from "./compute-step";
import { RepositoryStepBody, type GitHubAccess } from "./repository-step";
import { SetupSummary, Step, type StepInfo } from "./step";

/** A saved bot as the edit page loads it. */
export type SavedBot = BotSettings & {
  id: string;
  knownChannels?: Array<{ id: string; name: string }>;
};

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

/** `url#branch` as the repository field takes it: a /tree/ URL keeps the branch. */
function repoFieldValue(repo: string | undefined): string {
  if (!repo) return "";
  const [url = "", branch] = repo.split("#");
  return branch ? `${url}/tree/${branch}` : url;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The bot setup flow: creates a bot, or edits a saved one when `bot` is given. */
export function BotSetup({ bot }: { bot?: SavedBot }) {
  const router = useRouter();
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
  const [modelInput, setModelInput] = useState<string | null>(bot?.model ?? null);
  const active = credentials.filter((credential) => credential.isActive);
  const savedProvider = bot?.model.split("/")[0];
  const firstProvider = active[0]?.logicalProviderKey;
  const credential =
    active.find((candidate) => candidate.id === credentialId) ??
    (bot
      ? active.find(
          (candidate) =>
            candidate.logicalProviderKey === savedProvider &&
            (bot.credential ? candidate.label === bot.credential : candidate.isDefault),
        )
      : undefined) ??
    active.find(
      (candidate) => candidate.logicalProviderKey === firstProvider && candidate.isDefault,
    ) ??
    active[0];
  const model = modelInput ?? suggestModel(credential?.logicalProviderKey);
  const modelIssue = credential ? modelProblem(model, credential.logicalProviderKey) : null;
  const modelDone = !!credential && !modelIssue;

  // Repository
  const [githubAccess, setGithubAccess] = useState<GitHubAccess>(bot?.githubAccess ?? "connection");
  const [repoUrl, setRepoUrl] = useState(repoFieldValue(bot?.repo));
  const [branch, setBranch] = useState("");
  const repository = parseGitHubRepositoryInput(repoUrl);
  const repoDone = !!repository;

  // Tools: a saved bot's references until someone changes the selection.
  const tools = connections.filter(
    (connection) =>
      (connection.integration === "mcp" || connection.integration === "executor") &&
      connection.status === "connected",
  );
  const [toolIds, setToolIds] = useState<string[] | null>(bot ? null : []);
  const selectedTools =
    toolIds === null
      ? tools.filter((tool) =>
          bot?.connections.some(
            (ref) => ref === tool.id || ref.toLowerCase() === tool.name.trim().toLowerCase(),
          ),
        )
      : tools.filter((tool) => toolIds.includes(tool.id));
  const toggleTool = (id: string, on: boolean) => {
    const current = selectedTools.map((tool) => tool.id);
    setToolIds(on ? [...current, id] : current.filter((entry) => entry !== id));
  };

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
  // Nothing is picked until someone clicks a provider; until then sandboxes use the default.
  const [provider, setProvider] = useState<string | null>(bot?.provider ?? null);
  const providerName = (key: string | null) =>
    computeOptions.find((option) => option.key === key)?.name;

  const [platform, setPlatform] = useState<Platform | null>(bot?.platform ?? null);

  const [behavior, setBehavior] = useState<BotBehavior>({
    channels: bot?.channels ?? [],
    allowedUsers: bot?.allowedUsers ?? [],
    allowGuests: bot?.allowGuests ?? false,
    instructions: bot?.instructions ?? "",
    setup: bot?.setup ?? "",
  });

  // Saving
  const [name, setName] = useState(bot?.name ?? "");
  const [savedId, setSavedId] = useState<string | null>(bot?.id ?? null);
  const [token, setToken] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const defaultName = repository ? `${repository.repo} bot` : "Coding agent";

  const settings: BotSettings | null =
    modelDone && repository && platform
      ? {
          name: name.trim() || defaultName,
          platform,
          repo: `${repository.normalizedUrl}${branch ? `#${branch}` : ""}`,
          model: model.trim(),
          credential: credential && !credential.isDefault ? credential.label : null,
          connections:
            toolIds === null && bot ? bot.connections : connectionRefs(selectedTools, connections),
          provider,
          githubAccess,
          channels: behavior.channels,
          allowedUsers: behavior.allowedUsers,
          allowGuests: behavior.allowGuests,
          instructions: behavior.instructions.trim() || null,
          setup: behavior.setup.trim() || null,
        }
      : null;

  const refreshBots = () =>
    void queryClient.invalidateQueries({ queryKey: trpc.bots.list.queryKey() });
  const create = useMutation(
    trpc.bots.create.mutationOptions({
      onSuccess: (result) => {
        setSavedId(result.bot.id);
        setToken(result.token);
        // Becomes the bot's own page without remounting, so the one-time token stays visible.
        window.history.replaceState(null, "", `/dashboard/bots/${result.bot.id}`);
        refreshBots();
      },
      onError: (error) => toast.error(`Could not create the bot: ${error.message}`),
    }),
  );
  const update = useMutation(
    trpc.bots.update.mutationOptions({
      onSuccess: () => {
        toast.success("Saved. Restart the bot to apply the changes.");
        refreshBots();
      },
      onError: (error) => toast.error(`Could not save: ${error.message}`),
    }),
  );
  const rotate = useMutation(
    trpc.bots.rotateToken.mutationOptions({
      onSuccess: (result) => {
        setToken(result.token);
        toast.success("New token created. Update the bot's .env; the old token stopped working.");
        refreshBots();
      },
      onError: (error) => toast.error(`Could not create a token: ${error.message}`),
    }),
  );
  const remove = useMutation(
    trpc.bots.delete.mutationOptions({
      onSuccess: () => {
        refreshBots();
        router.push("/dashboard/bots" as Route);
      },
      onError: (error) => toast.error(`Could not delete the bot: ${error.message}`),
    }),
  );

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
          : "MCP servers the agent can use",
      }
    : null;
  const computeStep: StepInfo | null =
    computeOptions.length > 1
      ? {
          id: "bot-compute",
          title: "Compute",
          state: provider ? "done" : "optional",
          summary: provider
            ? providerName(provider)
            : `Your default${defaultKey ? ` · ${providerName(defaultKey)}` : ""}`,
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
  const customised =
    behavior.channels.length > 0 ||
    behavior.allowedUsers.length > 0 ||
    behavior.allowGuests ||
    !!behavior.instructions.trim() ||
    !!behavior.setup.trim();
  const behaviorStep: StepInfo = {
    id: "bot-behavior",
    title: "Behavior",
    state: customised ? "done" : "optional",
    summary: `${behavior.channels.length ? plural(behavior.channels.length, "channel") : "Every channel"} · ${behavior.allowedUsers.length ? `${behavior.allowedUsers.length} ${behavior.allowedUsers.length === 1 ? "person" : "people"}` : "everyone"}`,
  };
  const deployStep: StepInfo = {
    id: "bot-deploy",
    title: "Deploy",
    state: savedId ? "done" : "todo",
    summary: savedId ? (token ? "Token ready to copy" : "Saved") : "Name it and create it",
  };
  const steps = [
    modelStep,
    repoStep,
    ...(computeStep ? [computeStep] : []),
    ...(toolsStep ? [toolsStep] : []),
    platformStep,
    behaviorStep,
    deployStep,
  ];
  const number = (step: StepInfo) => steps.indexOf(step) + 1;

  const modelHint = !credential ? (
    "Add a model credential."
  ) : modelIssue ? (
    "Enter a valid model ID."
  ) : (
    <>
      Runs <span className="font-mono text-[12px] text-fg-2">{model.trim()}</span> with{" "}
      {credential.providerDisplayName}.
    </>
  );

  if (isLoadingCatalog) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-80 bg-fill" />
        <Skeleton className="h-40 w-full bg-fill" />
        <Skeleton className="h-40 w-full bg-fill" />
      </div>
    );
  }

  const editFooter = savedId ? (
    <>
      <Button
        className="h-9 w-full gap-2"
        disabled={!settings || update.isPending}
        onClick={() => settings && update.mutate({ id: savedId, ...settings })}
      >
        {update.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Save className="size-4" />
        )}
        Save changes
      </Button>
      {confirmDelete ? (
        <div className="flex items-center justify-between gap-2 text-xs text-fg-3">
          <span>Delete it and revoke its token?</span>
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-xs"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: savedId })}
            >
              Delete
            </Button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex w-full items-center justify-center gap-1.5 text-xs text-fg-4 transition-colors hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Delete bot
        </button>
      )}
    </>
  ) : undefined;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <aside className="lg:sticky lg:top-8 lg:order-last">
        <SetupSummary steps={steps} footer={editFooter} />
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
              selected={provider}
              defaultKey={defaultKey}
              onSelect={setProvider}
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
                        checked={selectedTools.some((entry) => entry.id === tool.id)}
                        onCheckedChange={(checked) => toggleTool(tool.id, checked === true)}
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
                onClick={() => {
                  // Channel and people ids belong to one platform; they don't carry over.
                  if (platform && option.value !== platform) {
                    setBehavior((current) => ({ ...current, channels: [], allowedUsers: [] }));
                  }
                  setPlatform(option.value);
                }}
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
          step={behaviorStep}
          number={number(behaviorStep)}
          hint="Where it answers, who can use it, and what the agent should know."
        >
          <BehaviorStepBody
            platform={platform}
            knownChannels={bot?.knownChannels ?? []}
            behavior={behavior}
            onChange={(patch) => setBehavior((current) => ({ ...current, ...patch }))}
          />
        </Step>

        <Step
          step={deployStep}
          number={number(deployStep)}
          hint="Its token, the .env, and how to run it."
        >
          <div className="space-y-8">
            <div className="space-y-2">
              <label
                htmlFor="bot-display-name"
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-4"
              >
                Name in GitTerm
              </label>
              <div className="flex flex-wrap gap-3">
                <Input
                  id="bot-display-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={defaultName}
                  maxLength={100}
                  className="min-w-56 flex-1"
                />
                {savedId ? null : (
                  <Button
                    className="h-10 gap-2"
                    disabled={!settings || create.isPending}
                    onClick={() => settings && create.mutate(settings)}
                  >
                    {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Create bot
                  </Button>
                )}
              </div>
              {savedId ? null : (
                <p className="text-xs text-fg-4">
                  Saves the bot and creates its GitTerm token, shown once.
                </p>
              )}
            </div>

            {savedId && platform ? (
              <DeployInstructions
                platform={platform}
                token={token}
                githubToken={githubAccess === "token"}
                rotating={rotate.isPending}
                onRotate={() => rotate.mutate({ id: savedId })}
              />
            ) : null}
          </div>
        </Step>
      </div>
    </div>
  );
}
