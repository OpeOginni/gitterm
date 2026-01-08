import { DashboardHeader, DashboardShell } from "@/components/dashboard/shell";
import { AgentLoopList } from "@/components/dashboard/agent-loops";
import { CreateInstanceDialog } from "@/components/dashboard/create-instance-dialog";

export default function AgentLoopsPage() {
  return (
    <DashboardShell>
      <DashboardHeader
        heading="Agent Loops"
        text="Monitor and manage your autonomous coding agents."
      >
        <CreateInstanceDialog />
      </DashboardHeader>
      <div className="grid gap-8 pt-8">
        <AgentLoopList />
      </div>
    </DashboardShell>
  );
}
