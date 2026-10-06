import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { BotSetup } from "@/components/dashboard/bots/bot-setup";

export default function NewBotPage() {
  return (
    <DashboardShell>
      <DashboardHeader
        heading="New bot"
        text="Pick a model, a repository, and a platform. Everything except secrets is saved here."
      />
      <BotSetup />
    </DashboardShell>
  );
}
