/**
 * Shared marketing data: sandbox providers and coding agents.
 *
 * Facts come from docs/agent-sandboxes.md. Keep them in sync with that file (and the docs
 * site), never invent capabilities here.
 */

export type SandboxProviderId = "e2b" | "daytona" | "vercel" | "boat" | "exe" | "railway" | "aws";

export type SandboxProvider = {
  id: SandboxProviderId;
  name: string;
  logo: string;
  /** Bring-your-own-key ("direct") accounts are supported. AWS is managed only. */
  byoKey: boolean;
  /** Previews are always public (Vercel). Otherwise they start private. */
  publicPreviews: boolean;
  /** One-line summary for captions. */
  note: string;
};

export const SANDBOX_PROVIDERS: SandboxProvider[] = [
  {
    id: "e2b",
    name: "E2B",
    logo: "/E2B.svg",
    byoKey: true,
    publicPreviews: false,
    note: "Private or public previews. Deleted at the end of its lifetime.",
  },
  {
    id: "daytona",
    name: "Daytona",
    logo: "/daytona.svg",
    byoKey: true,
    publicPreviews: false,
    note: "Private or public previews. Deleted at the end of its lifetime.",
  },
  {
    id: "vercel",
    name: "Vercel",
    logo: "/vercel.svg",
    byoKey: true,
    publicPreviews: true,
    note: "Public preview URLs. Stopped at the timeout, files discarded.",
  },
  {
    id: "boat",
    name: "Boat",
    logo: "/boat.svg",
    byoKey: true,
    publicPreviews: false,
    note: "Private previews. Archived at the TTL, storage kept until you destroy it.",
  },
  {
    id: "exe",
    name: "exe.dev",
    logo: "/exe.png",
    byoKey: true,
    publicPreviews: false,
    note: "Private previews on ports 3000 to 9999. Never deleted by the provider.",
  },
  {
    id: "railway",
    name: "Railway",
    logo: "/railway.svg",
    byoKey: true,
    publicPreviews: false,
    note: "Private previews, port 8080 reserved. Never deleted by the provider.",
  },
  {
    id: "aws",
    name: "AWS",
    logo: "/ECS.svg",
    byoKey: false,
    publicPreviews: false,
    note: "Runs on your Gitterm plan only. Private previews, port 8080 reserved.",
  },
];

/** Shown in provider rows, but not selectable: sandboxes there are planned. */
export const PLANNED_PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare", logo: "/cloudflare.svg" },
];

export type AgentId = "opencode" | "codex" | "claude";

/** Agents a cloud workspace can run. Codex and Claude Code run inside T3 Code. */
export const AGENTS: { id: AgentId; name: string; logo: string; viaT3: boolean }[] = [
  { id: "opencode", name: "OpenCode", logo: "/opencode.svg", viaT3: false },
  { id: "codex", name: "Codex", logo: "/openai-codex.svg", viaT3: true },
  { id: "claude", name: "Claude Code", logo: "/claude.svg", viaT3: true },
];

export const T3_LOGO = "/t3.svg";

export const INSTALL_SANDBOX_TOOLS = "opencode plugin add @gitterm/opencode-sandbox-tools";
export const GITHUB_URL = "https://github.com/OpeOginni/gitterm";
