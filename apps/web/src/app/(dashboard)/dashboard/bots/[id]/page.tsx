import { DashboardShell } from "@/components/dashboard/shell";
import { BotEditor } from "@/components/dashboard/bots/bot-editor";

export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <DashboardShell>
      <BotEditor id={id} />
    </DashboardShell>
  );
}
