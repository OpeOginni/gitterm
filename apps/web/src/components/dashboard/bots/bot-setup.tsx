"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { botSettingsSchema, type BotSettings } from "@gitterm/schema";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { parseGitHubRepositoryInput } from "../create-instance/github-repository-utils";
import type { ModelCredential } from "../model-credentials/types";
import { BehaviorStepBody, type BotBehavior } from "./behavior-step";
import { connectionRefs, modelProblem, suggestModel, type Platform } from "./config";
import { DeployInstructions } from "./config-step";
import { ModelStepBody } from "./model-step";
import { ComputeStepBody, type ComputeOption } from "./compute-step";
import { RepositoryStepBody, type GitHubAccess } from "./repository-step";
import { Radio, SetupSummary, Step, choiceTile, type StepInfo } from "./step";

/** A saved bot as the edit page loads it. */
export type SavedBot = BotSettings & { id: string };

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

/** Only the saved fields, in schema order, so a form value and a saved bot compare as strings. */
const settingsKey = (settings: BotSettings) =>
  JSON.stringify(settings, Object.keys(botSettingsSchema.shape));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const sandboxes = (count: number) => `${count} ${count === 1 ? "sandbox" : "sandboxes"}`;
const refreshBots = () =>
  void queryClient.invalidateQueries({ queryKey: trpc.bots.list.queryKey() });

/** The bot setup flow: creates a bot, or edits a saved one when `bot` is given. */
export function BotSetup({
  bot,
  initialPlatform,
}: {
  bot?: SavedBot;
  /** A new bot's platform, when someone came from that platform's link. */
  initialPlatform?: Platform;
}) {
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
  // A saved bot whose key was removed: say so, rather than blame the model it was saved with.
  const savedKeyGone =
    !!bot &&
    model === bot.model &&
    !active.some((candidate) => candidate.logicalProviderKey === savedProvider);
  const modelIssue = !credential
    ? null
    : savedKeyGone
      ? `It was saved with ${savedProvider}, and there's no ${savedProvider} key now. Add one, or change the model to start with ${credential.logicalProviderKey}/.`
      : modelProblem(model, credential.logicalProviderKey);
  const modelDone = !!credential && !modelIssue;

  // Repository
  const [githubAccess, setGithubAccess] = useState<GitHubAccess>(bot?.githubAccess ?? "connection");
  const [repoUrl, setRepoUrl] = useState(repoFieldValue(bot?.repo));
  // Starts as saved, so an unedited bot doesn't briefly differ from it.
  const [branch, setBranch] = useState(bot?.repo.split("#")[1] ?? "");
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

  const [platform, setPlatform] = useState<Platform | null>(
    bot?.platform ?? initialPlatform ?? null,
  );

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
  const [savedKey, setSavedKey] = useState(() => (bot ? settingsKey(bot) : null));
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
  const changed = !!settings && settingsKey(settings) !== savedKey;

  const create = useMutation(
    trpc.bots.create.mutationOptions({
      onSuccess: (result, input) => {
        if (platform) track("bot_created", { platform });
        setSavedId(result.bot.id);
        setSavedKey(settingsKey(input));
        setToken(result.token);
        // Becomes the bot's own page without remounting, so the one-time token stays visible.
        window.history.replaceState(null, "", `/dashboard/bots/${result.bot.id}`);
        refreshBots();
        // The token and run commands appear in the last step: bring it into view.
        requestAnimationFrame(() =>
          document.getElementById("bot-deploy")?.scrollIntoView({ behavior: "smooth" }),
        );
      },
      onError: (error) => toast.error(`Could not create the bot: ${error.message}`),
    }),
  );
  const update = useMutation(
    trpc.bots.update.mutationOptions({
      onSuccess: (_, input) => {
        setSavedKey(settingsKey(input));
        toast.success("Saved. A running bot applies it within a minute.");
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
  // Counted only while the dialog is open: the sandboxes deleting the bot terminates.
  const { data: sandboxCount, isLoading: isCountingSandboxes } = useQuery({
    ...trpc.bots.sandboxCount.queryOptions({ id: savedId ?? "" }),
    enabled: confirmDelete && !!savedId,
  });
  const remove = useMutation(
    trpc.bots.delete.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          `Bot deleted${result.terminated ? `, with ${sandboxes(result.terminated)}` : ""}.`,
        );
        if (result.failed)
          toast.warning(
            `${sandboxes(result.failed)} still need cleanup. Gitterm will retry automatically.`,
          );
        refreshBots();
        void queryClient.invalidateQueries({ queryKey: trpc.workspace.listWorkspaces.queryKey() });
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
  ) : savedKeyGone ? (
    "Its model's key was removed."
  ) : modelIssue ? (
    "Enter a valid model ID."
  ) : (
    <>
      Runs <span className="font-mono text-[13px] text-fg-2">{model.trim()}</span> with{" "}
      {credential.providerDisplayName}.
    </>
  );

  if (isLoadingCatalog) return <BotSetupSkeleton />;

  const createBot = () => settings && create.mutate(settings);
  const save = () => savedId && settings && update.mutate({ id: savedId, ...settings });

  const railFooter = savedId ? (
    <>
      <Button
        variant={changed ? "default" : "secondary"}
        className={cn("h-10 w-full gap-2", !changed && "text-fg-3 disabled:opacity-100")}
        disabled={!changed || update.isPending}
        onClick={save}
      >
        {update.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Save className="size-4" />
        )}
        Save changes
      </Button>
      <p className="text-center text-[12.5px] text-fg-4">
        {changed ? "A running bot picks it up within a minute." : "Everything is saved."}
      </p>
    </>
  ) : (
    <>
      <Button
        className="h-10 w-full gap-2"
        disabled={!settings || create.isPending}
        onClick={createBot}
      >
        {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Create bot
      </Button>
      <p className="text-center text-[12.5px] text-fg-4">
        {settings ? "Creates its token, shown once." : "Finish the required steps first."}
      </p>
    </>
  );

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_288px] xl:gap-12">
      <aside className="lg:sticky lg:top-8 lg:order-last">
        <SetupSummary steps={steps} footer={railFooter} />
      </aside>

      <div className="min-w-0">
        <div className="divide-y divide-line">
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
                  <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                    {tools.map((tool) => (
                      <label
                        key={tool.id}
                        className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 text-[13.5px] transition-colors hover:bg-fill"
                      >
                        <Checkbox
                          checked={selectedTools.some((entry) => entry.id === tool.id)}
                          onCheckedChange={(checked) => toggleTool(tool.id, checked === true)}
                        />
                        <span className="min-w-0 flex-1 truncate text-fg">{tool.name}</span>
                        <span className="text-[12.5px] text-fg-4">
                          {tool.integration === "executor" ? "Executor" : "MCP"}
                        </span>
                      </label>
                    ))}
                  </div>
                  <Link
                    href={"/dashboard/integrations" as Route}
                    className="inline-block text-[13px] text-fg-3 underline decoration-line-2 underline-offset-2 hover:text-fg"
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
            <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup">
              {PLATFORMS.map((option) => {
                const selected = platform === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      // Channel and people ids belong to one platform; they don't carry over.
                      if (platform && option.value !== platform) {
                        setBehavior((current) => ({ ...current, channels: [], allowedUsers: [] }));
                      }
                      setPlatform(option.value);
                    }}
                    className={cn(choiceTile(selected), "flex items-center gap-3.5 px-4 py-3.5")}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-fill">
                      <Image src={option.logo} alt="" width={20} height={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium text-fg">{option.label}</span>
                      <span className="block truncate text-[13px] text-fg-3">
                        {option.description}
                      </span>
                    </span>
                    <Radio selected={selected} />
                  </button>
                );
              })}
            </div>
          </Step>

          <Step
            step={behaviorStep}
            number={number(behaviorStep)}
            hint={
              platform
                ? "Where it answers, who can use it, and what the agent should know."
                : "Pick a platform first."
            }
          >
            {platform ? (
              <BehaviorStepBody
                platform={platform}
                behavior={behavior}
                onChange={(patch) => setBehavior((current) => ({ ...current, ...patch }))}
              />
            ) : null}
          </Step>

          <Step
            step={deployStep}
            number={number(deployStep)}
            hint={
              savedId
                ? "Its token, the .env, and how to run it."
                : "Name it, then create it to get its token."
            }
          >
            <div className="space-y-10">
              <div className="space-y-2">
                <label htmlFor="bot-display-name" className="text-[13px] font-medium text-fg-2">
                  Name in Gitterm
                </label>
                <div className="flex flex-wrap gap-3">
                  <Input
                    id="bot-display-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={defaultName}
                    maxLength={100}
                    className="h-10 min-w-56 flex-1"
                  />
                  {savedId ? null : (
                    <Button
                      className="h-10 gap-2 max-sm:w-full"
                      disabled={!settings || create.isPending}
                      onClick={createBot}
                    >
                      {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                      Create bot
                    </Button>
                  )}
                </div>
                {savedId ? null : (
                  <p className="text-[12.5px] text-fg-4">
                    Saves the bot and creates its Gitterm token, shown once.
                  </p>
                )}
              </div>

              {savedId && platform ? (
                <DeployInstructions
                  name={name.trim() || defaultName}
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

        {savedId ? (
          <section className="mt-2 flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-[14px] font-medium text-fg">Delete this bot</h2>
              <p className="text-[13px] leading-relaxed text-fg-3">
                Its token stops working and the sandboxes it started are terminated.
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete bot
            </Button>
          </section>
        ) : null}

        {/* Phones: the rail's save sits at the top of the page, so unsaved changes get a bar here. */}
        {savedId && changed ? (
          <div className="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-line bg-background/90 py-3 pr-20 pl-4 backdrop-blur-md sm:-mx-6 sm:pl-6 md:-mx-8 md:pl-8 lg:hidden">
            <span className="text-[13px] text-fg-3">Unsaved changes</span>
            <Button className="gap-2" disabled={update.isPending} onClick={save}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        ) : null}
      </div>

      {savedId ? (
        <Dialog
          open={confirmDelete}
          onOpenChange={(open) => !remove.isPending && setConfirmDelete(open)}
        >
          <DialogContent className="border-line bg-settings-dialog sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Delete {name.trim() || defaultName}?</DialogTitle>
              <DialogDescription>
                Its token stops working, and{" "}
                {isCountingSandboxes
                  ? "every sandbox it created"
                  : sandboxCount
                    ? `its ${sandboxes(sandboxCount)}`
                    : "any sandbox it created"}{" "}
                will be terminated. Work that wasn&apos;t pushed is lost. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(false)}
                disabled={remove.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="gap-2"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: savedId })}
              >
                {remove.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete bot
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * The setup's shape while it loads: numbered steps beside the "Your bot" card. The first two
 * steps are always Model and Repository, so their titles show for real.
 */
export function BotSetupSkeleton() {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_288px] xl:gap-12">
      <aside className="lg:order-last">
        <div className="overflow-hidden rounded-xl border border-line bg-background">
          <div className="space-y-3.5 px-5 pt-5 pb-4">
            <span className="block font-display text-[17px] font-semibold tracking-[-0.01em] text-fg">
              Your bot
            </span>
            <Skeleton className="h-1 w-full rounded-full bg-fill-2" />
          </div>
          <ol className="hidden px-2 pb-2 lg:block">
            {Array.from({ length: 7 }, (_, index) => (
              <li key={index} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="size-6 shrink-0 rounded-full bg-fill-2" />
                <span className="min-w-0 flex-1">
                  <span className="flex h-5 items-center">
                    <Skeleton className="h-3 w-20 bg-fill-2" />
                  </span>
                  <span className="flex h-[18px] items-center">
                    <Skeleton className="h-2.5 w-32 bg-fill-2" />
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <div className="hidden space-y-2 border-t border-line p-4 lg:block">
            <Skeleton className="h-10 w-full rounded-lg bg-fill-2" />
            <div className="flex h-[18px] items-center justify-center">
              <Skeleton className="h-2.5 w-36 bg-fill-2" />
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 divide-y divide-line">
        {["Model", "Repository", null].map((title, index) => (
          <section key={index} className="py-9 first:pt-0">
            <div className="flex items-center gap-3.5">
              <span className="w-6 shrink-0 font-mono text-[12.5px] text-fg-4 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              {title ? (
                <h2 className="font-display text-[20px] leading-tight font-semibold tracking-[-0.02em] text-fg">
                  {title}
                </h2>
              ) : (
                <Skeleton className="h-5 w-28 bg-fill-2" />
              )}
            </div>
            <div className="sm:pl-[38px]">
              <div className="mt-1.5 flex h-[22px] items-center">
                <Skeleton className="h-3 w-72 max-w-full bg-fill-2" />
              </div>
              <Skeleton className="mt-5 h-24 w-full rounded-xl bg-fill-2" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
