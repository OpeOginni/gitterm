// import { DashboardShell } from "@/components/dashboard/shell";
// import { AgentLoopDetail } from "@/components/dashboard/agent-loops";

import { redirect } from "next/navigation";

// Agent Loops is being phased out. Redirect to dashboard.
export default function AgentLoopsPage() {
  redirect("/dashboard");
}

// interface LoopPageProps {
//   params: Promise<{ id: string }>;
// }

// export default async function LoopPage({ params }: LoopPageProps) {
//   const { id } = await params;

//   return (
//     <DashboardShell>
//       <AgentLoopDetail loopId={id} />
//     </DashboardShell>
//   );
// }
