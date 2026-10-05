"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { slackManifest } from "@gitterm/slack-bot/manifest";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BOT_TOKEN_SCOPES, codeSnippet, envFile, type BotConfig } from "./config";
import { CodeBlock } from "./step";

const subheadClass = "font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4";
const code = "rounded bg-fill-2 px-1 py-0.5 font-mono text-[12px] text-fg-2";

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-fg-3 marker:text-fg-4">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

function SlackSetup() {
  const [name, setName] = useState("GitTerm Agent");
  const botName = name.trim() || "GitTerm Agent";
  const href = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(botName)))}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="bot-name" className={subheadClass}>
            Bot name
          </Label>
          <Input
            id="bot-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={35}
            className="h-9 w-56"
          />
        </div>
        <Button asChild className="h-9 gap-1.5">
          <a href={href} target="_blank" rel="noopener noreferrer">
            Create the Slack app
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>
      <Steps
        items={[
          <>
            Install the app to your workspace, then copy the Bot User OAuth Token into{" "}
            <span className={code}>SLACK_BOT_TOKEN</span>.
          </>,
          <>
            Under Basic Information → App-Level Tokens, create a token with{" "}
            <span className={code}>connections:write</span> and copy it into{" "}
            <span className={code}>SLACK_APP_TOKEN</span>.
          </>,
          <>
            Start the bot, then run <span className={code}>/invite @{botName}</span> in a channel.
          </>,
        ]}
      />
    </div>
  );
}

function DiscordSetup() {
  return (
    <div className="space-y-4">
      <Button asChild className="h-9 gap-1.5">
        <a
          href="https://discord.com/developers/applications"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the Discord developer portal
          <ExternalLink className="size-3.5" />
        </a>
      </Button>
      <Steps
        items={[
          "Create an application and open its Bot page.",
          <>
            Reset the token and copy it into <span className={code}>DISCORD_BOT_TOKEN</span>.
          </>,
          "On the same page, turn on Message Content Intent.",
          "Start the bot. It prints the link that adds it to your server.",
        ]}
      />
    </div>
  );
}

export function ConfigStepBody({
  token,
  onToken,
  config,
  missing,
}: {
  /** The created token; shown once, kept only in page state. */
  token: string | null;
  onToken: (token: string) => void;
  config: Omit<BotConfig, "token">;
  /** Why the token can't be created yet, if anything is missing. */
  missing: string | null;
}) {
  const platformName = config.platform === "slack" ? "Slack" : "Discord";
  const create = useMutation(
    trpc.apiTokens.create.mutationOptions({
      onSuccess: (result) => {
        onToken(result.token);
        void queryClient.invalidateQueries({ queryKey: trpc.apiTokens.list.queryKey() });
      },
      onError: (error) => toast.error(`Failed to create token: ${error.message}`),
    }),
  );

  const createButton = (
    <Button
      className="gap-2"
      disabled={!!missing || create.isPending}
      onClick={() =>
        create.mutate({
          name: `${platformName} bot`,
          scopes: BOT_TOKEN_SCOPES,
          expiresInDays: 365,
        })
      }
    >
      {create.isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <KeyRound className="size-4" />
      )}
      Create bot token
    </Button>
  );

  if (!token && missing) {
    // Centred so what's blocking the token is the first thing seen here.
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="text-sm text-fg-2">{missing}</p>
        {createButton}
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-lg text-[13px] leading-relaxed text-fg-3">
          {`Creates an API token named "${platformName} bot" with only the permissions a bot needs. It expires in 1 year.`}
        </p>
        {createButton}
      </div>
    );
  }

  const full = { ...config, token };
  const pkg = `@gitterm/${config.platform}-bot`;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h4 className={subheadClass}>1 · Save this as .env</h4>
        <p className="flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          The token is shown only once. Copy the file now.
        </p>
        <CodeBlock code={envFile(full)} copyLabel=".env" />
      </section>

      <section className="space-y-3">
        <h4 className={subheadClass}>2 · Create the {platformName} bot</h4>
        {config.platform === "slack" ? <SlackSetup /> : <DiscordSetup />}
      </section>

      <section className="space-y-3">
        <h4 className={subheadClass}>3 · Run it</h4>
        <Tabs defaultValue="terminal">
          <TabsList>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
          </TabsList>
          <TabsContent value="terminal" className="space-y-2">
            <p className="text-xs text-fg-4">In the folder with the .env:</p>
            <CodeBlock code={`npx ${pkg}`} copyLabel="Command" />
          </TabsContent>
          <TabsContent value="code" className="space-y-2">
            <p className="text-xs text-fg-4">
              Install <span className={code}>{pkg}</span> and run with{" "}
              <span className={code}>node --env-file=.env</span>. Tokens come from the .env.
            </p>
            <CodeBlock code={codeSnippet(full)} copyLabel="Code" />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
