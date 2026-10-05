"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { slackManifest } from "@gitterm/slack-bot/manifest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { codeSnippet, dockerCommand, envFile, type Platform } from "./config";
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

/** The deploy instructions: the .env (secrets only), the platform app, and how to run it. */
export function DeployInstructions({
  platform,
  token,
  githubToken,
  rotating,
  onRotate,
}: {
  platform: Platform;
  /** Shown once, right after the bot is created or its token replaced. */
  token: string | null;
  githubToken: boolean;
  rotating: boolean;
  onRotate: () => void;
}) {
  const platformName = platform === "slack" ? "Slack" : "Discord";
  const pkg = `@gitterm/${platform}-bot`;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className={subheadClass}>1 · Save this as .env</h4>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={onRotate}
            disabled={rotating}
          >
            {rotating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <KeyRound className="size-3.5" />
            )}
            New token
          </Button>
        </div>
        {token ? (
          <p className="flex items-start gap-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            The token is shown only once. Copy the file now.
          </p>
        ) : (
          <p className="text-xs text-fg-4">
            Only secrets go here; the bot loads everything else from GitTerm when it starts. New
            token replaces the old one, which stops working.
          </p>
        )}
        <CodeBlock code={envFile({ platform, token, githubToken })} copyLabel=".env" />
      </section>

      <section className="space-y-3">
        <h4 className={subheadClass}>2 · Create the {platformName} bot</h4>
        {platform === "slack" ? <SlackSetup /> : <DiscordSetup />}
      </section>

      <section className="space-y-3">
        <h4 className={subheadClass}>3 · Run it</h4>
        <Tabs defaultValue="docker">
          <TabsList>
            <TabsTrigger value="docker">Docker</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
          </TabsList>
          <TabsContent value="docker" className="space-y-2">
            <p className="text-xs text-fg-4">
              In the folder with the .env. It restarts on its own and keeps its threads in the{" "}
              <span className={code}>gitterm-{platform}-bot</span> volume; follow it with{" "}
              <span className={code}>docker logs -f gitterm-{platform}-bot</span>.
            </p>
            <CodeBlock code={dockerCommand(platform)} copyLabel="Command" />
          </TabsContent>
          <TabsContent value="terminal" className="space-y-2">
            <p className="text-xs text-fg-4">In the folder with the .env:</p>
            <CodeBlock code={`npx ${pkg}`} copyLabel="Command" />
          </TabsContent>
          <TabsContent value="code" className="space-y-2">
            <p className="text-xs text-fg-4">
              Install <span className={code}>{pkg}</span> and run with{" "}
              <span className={code}>node --env-file=.env</span>.
            </p>
            <CodeBlock code={codeSnippet(platform)} copyLabel="Code" />
          </TabsContent>
        </Tabs>
        <p className="text-xs text-fg-4">
          Changes saved here apply the next time the bot starts; restart it after saving.
        </p>
      </section>
    </div>
  );
}
