import { createBoatSandboxTransport } from "./boat";
import { createDaytonaSandboxTransport } from "./daytona";
import { createE2BSandboxTransport } from "./e2b";
import { createExeDevSandboxTransport } from "./exedev";
import { createRailwaySandboxTransport } from "./railway";
import type { SandboxTransport } from "./types";
import { createVercelSandboxTransport } from "./vercel";

export * from "./types";

/** Settings for providers usable with a caller-owned credential. AWS is managed-only. */
export type SandboxTransportConfig =
  | { provider: "e2b"; apiKey: string; template?: string }
  | { provider: "daytona"; apiKey: string; target?: "us" | "eu"; snapshot?: string }
  | {
      provider: "vercel";
      apiKey: string;
      teamId: string;
      projectId: string;
      runtime?: "node24" | "node22" | "python3.13";
    }
  | { provider: "boat"; apiKey: string; size?: "small" | "default" | "large" }
  | { provider: "exedev"; apiKey: string; image?: string }
  | {
      provider: "railway";
      apiKey: string;
      projectId: string;
      environmentId: string;
      apiUrl?: string;
      image?: string;
    };

export function createSandboxTransport(config: SandboxTransportConfig): SandboxTransport {
  switch (config.provider) {
    case "e2b":
      return createE2BSandboxTransport(config);
    case "daytona":
      return createDaytonaSandboxTransport(config);
    case "vercel":
      return createVercelSandboxTransport(config);
    case "boat":
      return createBoatSandboxTransport(config);
    case "exedev":
      return createExeDevSandboxTransport(config);
    case "railway":
      return createRailwaySandboxTransport(config);
  }
}
