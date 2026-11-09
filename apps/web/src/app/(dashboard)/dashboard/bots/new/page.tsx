import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { BackToBots } from "@/components/dashboard/bots/bot-editor";
import { BotSetup } from "@/components/dashboard/bots/bot-setup";

export default async function NewBotPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const { platform } = await searchParams;
  return (
    <DashboardShell>
      <div className="space-y-5">
        <BackToBots />
        <DashboardHeader
          heading="New bot"
          text="Pick a model, a repository and a platform. Everything except secrets is saved here."
        />
      </div>
      <BotSetup
        initialPlatform={platform === "slack" || platform === "discord" ? platform : undefined}
      />
    </DashboardShell>
  );
}
