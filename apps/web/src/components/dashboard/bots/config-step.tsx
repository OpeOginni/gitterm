"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { slackManifest } from "@gitterm/slack-bot/manifest";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { codeSnippet, dockerCommand, envFile, type Platform } from "./config";
import { CodeBlock } from "./step";

const subheadClass = "font-mono text-[10px] uppercase tracking-[0.22em] text-fg-4";
const code = "whitespace-nowrap rounded bg-fill-2 px-1 py-0.5 font-mono text-[12px] text-fg-2";

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-fg-3 marker:text-fg-4">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

function SlackSetup({ name }: { name: string }) {
  // Slack caps app and bot user names at 35 characters.
  const botName = name.slice(0, 35).trim();
  const manifest = JSON.stringify(slackManifest(botName), null, 2);
  const href = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`;
  return (
    <div className="space-y-4">
      <Button asChild className="h-9 gap-1.5">
        <a href={href} target="_blank" rel="noopener noreferrer">
          Create the Slack app
          <ExternalLink className="size-3.5" />
        </a>
      </Button>
      <Steps
        items={[
          <>
            If Slack doesn't fill in the manifest, choose <em>Create New App → From a manifest</em>,
            pick your workspace and paste the one below. For an app you already made, paste it under{" "}
            <em>App Manifest</em> and reinstall.
          </>,
          <>
            <em>Install to Workspace</em>, then copy the <em>Bot User OAuth Token</em> into{" "}
            <span className={code}>SLACK_BOT_TOKEN</span>.
          </>,
          <>
            Under <em>Basic Information → App-Level Tokens</em>, generate one with{" "}
            <span className={code}>connections:write</span> into{" "}
            <span className={code}>SLACK_APP_TOKEN</span>.
          </>,
          <>
            Start the bot, then <span className={code}>/invite @{botName}</span> in a channel.
          </>,
        ]}
      />
      <CodeBlock code={manifest} copyLabel="Manifest" language="json" collapsible />
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
          "Create an application. On its Bot page, reset the token into the .env and turn on Message Content Intent.",
          "Start the bot. It prints the link that adds it to your server.",
        ]}
      />
    </div>
  );
}

/** The deploy instructions: the .env (secrets only), the platform app, and how to run it. */
export function DeployInstructions({
  name,
  platform,
  token,
  githubToken,
  rotating,
  onRotate,
}: {
  /** The bot's name, which the Slack app takes too. */
  name: string;
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
        ) : null}
        <CodeBlock
          code={envFile({ platform, token, githubToken })}
          copyLabel=".env"
          language="env"
        />
      </section>

      <section className="space-y-3">
        <h4 className={subheadClass}>2 · Create the {platformName} bot</h4>
        {platform === "slack" ? <SlackSetup name={name} /> : <DiscordSetup />}
      </section>

      <section className="space-y-3">
        <h4 className={subheadClass}>3 · Run it</h4>
        <Tabs defaultValue="docker" className="gap-4 pt-1">
          <TabsList>
            <TabsTrigger value="docker">Docker</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
          </TabsList>
          <TabsContent value="docker" className="space-y-2">
            <p className="text-xs text-fg-4">
              Next to the .env. Logs:{" "}
              <span className={code}>docker logs -f gitterm-{platform}-bot</span>
            </p>
            <CodeBlock code={dockerCommand(platform)} copyLabel="Command" language="shell" />
          </TabsContent>
          <TabsContent value="terminal" className="space-y-2">
            <p className="text-xs text-fg-4">Next to the .env.</p>
            <CodeBlock code={`npx ${pkg}`} copyLabel="Command" language="shell" />
          </TabsContent>
          <TabsContent value="code" className="space-y-2">
            <p className="text-xs text-fg-4">
              Install <span className={code}>{pkg}</span> and run with{" "}
              <span className={code}>node --env-file=.env index.ts</span>.
            </p>
            <CodeBlock code={codeSnippet(platform)} copyLabel="index.ts" language="ts" />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
