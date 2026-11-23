import { opencodeAgent } from "./opencode.js";
import { piAgent } from "./pi.js";
import { t3Agent } from "./t3.js";
import type { AgentAdapter } from "./types.js";

/** Every agent whose sessions can move. Adding one is an adapter here. */
export const AGENTS: AgentAdapter[] = [t3Agent, piAgent, opencodeAgent];

export function agentByKey(key: string): AgentAdapter {
  const agent = AGENTS.find((item) => item.key === key);
  if (!agent)
    throw new Error(
      `Sessions of ${key} can't move yet. Supported: ${AGENTS.map((item) => item.key).join(", ")}.`,
    );
  return agent;
}

/** The agent and session this process runs in, when an agent runs the CLI itself. */
export function currentSession(env: NodeJS.ProcessEnv = process.env) {
  for (const agent of AGENTS) {
    const ref = agent.currentSession(env);
    if (ref) return { agent, ref };
  }
  return undefined;
}
