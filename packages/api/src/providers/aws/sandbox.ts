import { createHmac } from "node:crypto";
import env from "@gitterm/env/server";
import {
  createExecServerClient,
  EXEC_SERVER_PORT,
  EXEC_SERVER_SOURCE,
} from "@gitterm/agent-runtime/sandbox/exec-server";
import {
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  terminated,
  validatePort,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "@gitterm/agent-runtime/sandbox/types";
import { AWS_ROUTING_HEADER, AwsProvider, buildWorkspaceHost } from "./index";
import { isProviderResourceNotFound } from "../resource-not-found";

export const AWS_SANDBOX_IMAGE = "public.ecr.aws/docker/library/node:22-bookworm-slim";

/** Server-side only: derived from the deployment secret, never stored or sent to callers. */
function execToken(workspaceHost: string): string {
  const secret = env.ENCRYPTION_MASTER_KEY || env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new SandboxProviderError(
      "provider",
      "AWS sandboxes need ENCRYPTION_MASTER_KEY on the server.",
    );
  return createHmac("sha256", secret).update(`gitterm-aws-sandbox:${workspaceHost}`).digest("hex");
}

/**
 * A managed AWS sandbox: the deployment's ECS/ALB setup running a stock Node image whose
 * command is the Gitterm command server. Reached through the shared ALB with the
 * workspace routing header. AWS never deletes it on its own; the Gitterm worker does.
 */
export function createAwsSandboxTransport(cloudProviderId: string): SandboxTransport {
  const provider = new AwsProvider(cloudProviderId);
  const profile = SANDBOX_PROVIDER_PROFILES.aws;

  const handle = (id: string) => JSON.parse(id) as { workspaceId: string; workspaceHost: string };
  async function client(id: string) {
    const { workspaceHost } = handle(id);
    const config = await provider.getConfig();
    return createExecServerClient(config.albBaseUrl, execToken(workspaceHost), "AWS", {
      [AWS_ROUTING_HEADER]: workspaceHost,
    });
  }
  async function info(id: string): Promise<SandboxProviderInfo> {
    try {
      const status = await provider.getStatus(id);
      return { id, state: status.status, labels: {}, startedAt: null, expiresAt: null };
    } catch (error) {
      // Only a missing resource is a deletion; permission or network failures are failures.
      if (isProviderResourceNotFound(error)) return terminated(id);
      throw error;
    }
  }

  return {
    provider: "aws",
    ...profile,
    async create(input) {
      const workspaceId = input.labels.gitterm_workspace;
      const userId = input.labels.gitterm_user;
      if (!workspaceId || !userId)
        throw new Error("AWS sandboxes are created by the Gitterm server only");
      const workspaceHost = buildWorkspaceHost(workspaceId);
      const created = await provider.createWorkspace({
        workspaceId,
        userId,
        subdomain: workspaceId,
        imageId: input.template ?? AWS_SANDBOX_IMAGE,
        imageProviderMetadata: {
          aws: {
            command: ["sh", "-c", 'node -e "$GITTERM_EXEC_SERVER"'],
            containerPort: EXEC_SERVER_PORT,
            healthCheckPath: "/healthz",
          },
        },
        environmentVariables: {
          GITTERM_EXEC_TOKEN: execToken(workspaceHost),
          GITTERM_EXEC_SERVER: EXEC_SERVER_SOURCE,
          PORT: String(EXEC_SERVER_PORT),
        } as never,
      });
      return {
        id: created.externalServiceId,
        state: "running",
        labels: input.labels,
        startedAt: created.serviceCreatedAt.toISOString(),
        expiresAt: null,
      };
    },
    info,
    async list() {
      return [];
    },
    async destroy(id) {
      await provider.terminateWorkspace(id);
    },
    async pause(id) {
      await provider.pauseWorkspace(id);
    },
    async resume(id) {
      await provider.resumeWorkspace(id);
    },
    async run(id, command, options) {
      return (await client(id)).run(command, options);
    },
    async writeFile(id, path, data) {
      return (await client(id)).writeFile(path, data);
    },
    async readFile(id, path) {
      return (await client(id)).readFile(path);
    },
    async preview(id, port) {
      validatePort(port);
      if (port === EXEC_SERVER_PORT)
        throw new Error(`Port ${EXEC_SERVER_PORT} is reserved for Gitterm in AWS sandboxes`);
      return (await client(id)).preview(port);
    },
  };
}
