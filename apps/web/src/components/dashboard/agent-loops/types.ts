import type { trpc } from "@/utils/trpc";

// Type for a loop from listLoops
export type AgentLoop = NonNullable<
  (typeof trpc.agentLoop.listLoops)["~types"]["output"]
>["loops"][number];

// Type for a loop with runs from getLoop
export type AgentLoopWithRuns = NonNullable<
  (typeof trpc.agentLoop.getLoop)["~types"]["output"]
>["loop"];

// Type for a run
export type AgentLoopRun = AgentLoopWithRuns["runs"][number];

// Status types
export type LoopStatus = "active" | "paused" | "completed" | "archived";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
