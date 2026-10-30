import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import {
  classifyFailure,
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  terminated,
  validateLifetime,
  validatePort,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "./types";

const profile = SANDBOX_PROVIDER_PROFILES.vercel;
const failure = (error: unknown, action: string) => classifyFailure("Vercel", error, action);
type VercelSandbox = Awaited<ReturnType<typeof Sandbox.get>>;

/** Vercel accepts at most five tags; ownership tags are kept first. */
const TAG_PRIORITY = [
  "gitterm_account",
  "gitterm_workload",
  "gitterm_workspace",
  "gitterm_user",
  "gitterm_name",
  "gitterm_purpose",
  "gitterm_session",
];
function limitTags(labels: Record<string, string>): Record<string, string> {
  const rank = (key: string) => TAG_PRIORITY.indexOf(key) + 1 || 99;
  const keys = Object.keys(labels).toSorted((a, b) => rank(a) - rank(b));
  return Object.fromEntries(keys.slice(0, 5).map((key) => [key, labels[key]!]));
}

type Summary = {
  name: string;
  status: string;
  persistent: boolean;
  tags?: Record<string, string>;
  createdAt: number;
  timeout?: number;
};

function summaryInfo(summary: Summary): SandboxProviderInfo {
  return {
    id: summary.name,
    state: state(summary.status, summary.persistent),
    labels: summary.tags ?? {},
    startedAt: new Date(summary.createdAt).toISOString(),
    // Without persistence the provider ends the sandbox at its timeout.
    expiresAt:
      !summary.persistent && summary.timeout
        ? new Date(summary.createdAt + summary.timeout).toISOString()
        : null,
  };
}

/** A stopped sandbox without persistence has discarded its files: for us it is gone. */
function state(status: string, persistent: boolean): SandboxProviderInfo["state"] {
  if (status === "running") return "running";
  if (status === "pending" || status === "snapshotting") return "pending";
  if ((status === "stopping" || status === "stopped") && persistent) return "paused";
  return "terminated";
}

/**
 * Vercel Sandbox on its Node runtime (no coding agent). The provider stops the sandbox at
 * `timeout`; without persistence a stopped sandbox is gone. Port URLs are public.
 */
export function createVercelSandboxTransport(config: {
  apiKey: string;
  teamId: string;
  projectId: string;
  runtime?: "node24" | "node22" | "python3.13";
}): SandboxTransport {
  if (!config.apiKey?.trim()) throw new SandboxProviderError("auth", "Vercel token is empty.");
  if (!config.teamId?.trim() || !config.projectId?.trim())
    throw new Error("Vercel sandboxes need teamId and projectId");
  const credentials = { token: config.apiKey, teamId: config.teamId, projectId: config.projectId };

  const infoFrom = (sandbox: VercelSandbox): SandboxProviderInfo =>
    summaryInfo({
      name: sandbox.name,
      status: sandbox.status,
      persistent: sandbox.persistent,
      tags: sandbox.tags,
      createdAt: sandbox.createdAt.getTime(),
      timeout: sandbox.timeout,
    });
  const get = async (id: string) => {
    try {
      return await Sandbox.get({ ...credentials, name: id });
    } catch (error) {
      throw failure(error, "read the sandbox");
    }
  };
  const running = async (id: string) => {
    const sandbox = await get(id);
    if (sandbox.status !== "running")
      throw new SandboxProviderError("not_found", `The Vercel sandbox is ${sandbox.status}.`);
    return sandbox;
  };

  return {
    provider: "vercel",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const kill = (input.onTimeout ?? "kill") === "kill";
      const name = `gitterm-sbx-${randomBytes(6).toString("hex")}`;
      let sandbox: VercelSandbox;
      try {
        sandbox = await Sandbox.create({
          ...credentials,
          name,
          runtime: config.runtime ?? "node24",
          timeout: input.timeoutMs,
          // Managed sandboxes pause (stop with a snapshot) when idle; direct ones are discarded.
          persistent: !kill,
          tags: limitTags(input.labels),
        });
      } catch (error) {
        throw failure(error, "create a sandbox");
      }
      try {
        const check = await sandbox.runCommand("true");
        if (check.exitCode !== 0) throw new Error("sandbox did not run a command");
        return infoFrom(sandbox);
      } catch (error) {
        await sandbox.delete().catch(() => {});
        throw failure(error, "prepare the sandbox");
      }
    },

    async info(id) {
      try {
        return infoFrom(await Sandbox.get({ ...credentials, name: id }));
      } catch (error) {
        const classified = failure(error, "read the sandbox");
        if (classified.code === "not_found") return terminated(id);
        throw classified;
      }
    },

    async list(labels) {
      // The API filters on a single tag; the rest are checked here.
      const [first] = Object.entries(labels);
      try {
        const pages = await Sandbox.list({
          ...credentials,
          ...(first ? { tags: { [first[0]]: first[1] } as { gitterm_account: string } } : {}),
        });
        const items: SandboxProviderInfo[] = [];
        for await (const summary of pages as unknown as AsyncIterable<Summary>) {
          const info = summaryInfo(summary);
          if (
            Object.entries(labels).every(([key, value]) => info.labels[key] === value) &&
            info.state !== "terminated"
          )
            items.push(info);
          if (items.length >= 500) break;
        }
        return items;
      } catch (error) {
        throw failure(error, "list sandboxes");
      }
    },

    async destroy(id) {
      try {
        await (await Sandbox.get({ ...credentials, name: id })).delete();
      } catch (error) {
        const classified = failure(error, "delete the sandbox");
        if (classified.code !== "not_found") throw classified;
      }
    },

    async pause(id) {
      try {
        await (await get(id)).stop();
      } catch (error) {
        throw failure(error, "stop the sandbox");
      }
    },

    async resume(id) {
      try {
        await Sandbox.get({ ...credentials, name: id, resume: true });
      } catch (error) {
        throw failure(error, "resume the sandbox");
      }
    },

    async keepAlive(id, timeoutMs) {
      try {
        await (await get(id)).update({ timeout: timeoutMs });
      } catch (error) {
        throw failure(error, "extend the sandbox timeout");
      }
    },

    async run(id, command, options = {}) {
      const sandbox = await running(id);
      try {
        const result = await sandbox.runCommand({
          cmd: "bash",
          args: ["-c", command],
          cwd: options.cwd,
          env: options.env,
          signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        });
        return {
          exitCode: result.exitCode,
          stdout: await result.stdout(),
          stderr: await result.stderr(),
        };
      } catch (error) {
        throw failure(error, "run a command");
      }
    },

    async writeFile(id, path, data) {
      const sandbox = await running(id);
      try {
        await sandbox.writeFiles([{ path, content: Buffer.from(data) }]);
      } catch (error) {
        throw failure(error, "upload a file");
      }
    },

    async readFile(id, path) {
      const sandbox = await running(id);
      let data: Buffer | null;
      try {
        data = await sandbox.readFileToBuffer({ path });
      } catch (error) {
        throw failure(error, "download a file");
      }
      if (!data) throw new SandboxProviderError("not_found", `No file at ${path} in the sandbox.`);
      return new Uint8Array(data);
    },

    async preview(id, port) {
      validatePort(port);
      const sandbox = await running(id);
      try {
        // Ports are exposed on demand (up to 15 per sandbox).
        const exposed = sandbox.routes.map((route) => route.port);
        if (!exposed.includes(port)) await sandbox.update({ ports: [...exposed, port] });
        return { url: sandbox.domain(port), headers: {} };
      } catch (error) {
        throw failure(error, "expose the port");
      }
    },
  };
}
