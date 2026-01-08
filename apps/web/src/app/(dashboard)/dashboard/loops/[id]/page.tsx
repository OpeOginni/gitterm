import { DashboardShell } from "@/components/dashboard/shell";
import { AgentLoopDetail } from "@/components/dashboard/agent-loops";

interface LoopPageProps {
  params: Promise<{ id: string }>;
}

export default async function LoopPage({ params }: LoopPageProps) {
  const { id } = await params;

  return (
    <DashboardShell>
      <AgentLoopDetail loopId={id} />
    </DashboardShell>
  );
}
