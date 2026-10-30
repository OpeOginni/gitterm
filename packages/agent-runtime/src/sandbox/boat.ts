import { randomBytes } from "node:crypto";
import { BoxApi, Configuration, waitUntilReady, type Box } from "@asciidev/box-sdk";
import {
  accountHash,
  classifyFailure,
  SANDBOX_PROVIDER_PROFILES,
  SandboxProviderError,
  shellQuote,
  terminated,
  validateLifetime,
  validatePort,
  type SandboxProviderInfo,
  type SandboxTransport,
} from "./types";

const profile = SANDBOX_PROVIDER_PROFILES.boat;
const BASE_URL = "https://ascii.dev/api/box/v1";
const NAME_PREFIX = "gitterm-sbx-";
/** Boat's file write limit is unpublished; larger uploads are split and joined in the box. */
const WRITE_CHUNK_BYTES = 4 * 1024 * 1024;
const failure = (error: unknown, action: string) => classifyFailure("Boat", error, action);

function infoFrom(box: Box): SandboxProviderInfo {
  const match = new RegExp(`^${NAME_PREFIX}([a-f0-9]{10})-`).exec(box.name ?? "");
  return {
    id: box.id,
    state: ["ready", "idle", "running"].includes(box.state)
      ? "running"
      : box.state === "archived"
        ? "paused"
        : box.state === "error"
          ? "terminated"
          : "pending",
    labels: match ? { gitterm_account_hash: match[1]!, gitterm_workload: "sandbox" } : {},
    startedAt: box.createdAt ? new Date(box.createdAt).toISOString() : null,
    expiresAt: box.archiveAfter ? new Date(box.archiveAfter).toISOString() : null,
  };
}

/**
 * A Boat box. Boat's base image includes coding agent CLIs (claude, codex, opencode); they
 * are not started and receive no credentials. At its `ttlSeconds` Boat stops and archives
 * the box rather than deleting it, so storage remains until `destroy`.
 */
export function createBoatSandboxTransport(config: {
  apiKey: string;
  size?: "small" | "default" | "large";
}): SandboxTransport {
  if (!config.apiKey?.trim()) throw new SandboxProviderError("auth", "Boat apiKey is empty.");
  const client = new BoxApi(new Configuration({ basePath: BASE_URL, accessToken: config.apiKey }));

  const get = async (id: string) => {
    try {
      return (await client.get({ boxId: id })).box;
    } catch (error) {
      throw failure(error, "read the sandbox");
    }
  };
  const running = async (id: string) => {
    const box = await get(id);
    if (infoFrom(box).state !== "running")
      throw new SandboxProviderError("not_found", `The Boat box is ${box.state}.`);
  };

  async function command(id: string, script: string, timeoutMs = 60_000) {
    try {
      const result = (await client.command({
        boxId: id,
        commandRequest: {
          command: script,
          timeoutSeconds: Math.min(600, Math.max(1, Math.ceil(timeoutMs / 1000))),
        },
      })) as { exitCode?: number | null; stdout?: string; stderr?: string; timedOut?: boolean };
      return {
        exitCode: result.timedOut ? 124 : (result.exitCode ?? 1),
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    } catch (error) {
      throw failure(error, "run a command");
    }
  }

  async function destroy(id: string) {
    const response = await fetch(`${BASE_URL}/boxes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      // Boat requires the box id again as an explicit confirmation.
      headers: { Authorization: `Bearer ${config.apiKey}`, "X-Ascii-Confirm-Delete": id },
    }).catch((error) => {
      throw failure(error, "delete the sandbox");
    });
    if (response.status === 401 || response.status === 403)
      throw new SandboxProviderError(
        "auth",
        "Boat rejected the API key while trying to delete the sandbox.",
      );
    if (!response.ok && response.status !== 404)
      throw new SandboxProviderError(
        "provider",
        `Boat failed to delete the sandbox (${response.status}).`,
      );
  }

  return {
    provider: "boat",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const account = input.labels.gitterm_account ?? input.labels.gitterm_workspace ?? "managed";
      const name = `${NAME_PREFIX}${accountHash(account)}-${randomBytes(4).toString("hex")}`;
      let id: string;
      try {
        id = (
          await client.create({
            createBoxRequest: {
              type: config.size,
              ttlSeconds: Math.ceil(input.timeoutMs / 1000),
              noEnv: true,
            },
          })
        ).box.id;
      } catch (error) {
        throw failure(error, "create a sandbox");
      }
      try {
        await waitUntilReady(client, id);
        await client.update({ boxId: id, updateBoxRequest: { name } });
        return infoFrom(await get(id));
      } catch (error) {
        await destroy(id).catch(() => {});
        throw failure(error, "prepare the sandbox");
      }
    },

    async info(id) {
      try {
        return infoFrom((await client.get({ boxId: id })).box);
      } catch (error) {
        const classified = failure(error, "read the sandbox");
        if (classified.code === "not_found") return terminated(id);
        throw classified;
      }
    },

    async list(labels) {
      const items: SandboxProviderInfo[] = [];
      let cursor: string | null | undefined;
      try {
        do {
          const page = await client.boxes({ limit: 100, cursor });
          for (const box of page.boxes) {
            const info = infoFrom(box);
            if (info.labels.gitterm_workload !== "sandbox" || info.state === "terminated") continue;
            const wanted = labels.gitterm_account ? accountHash(labels.gitterm_account) : undefined;
            if (wanted && info.labels.gitterm_account_hash !== wanted) continue;
            items.push(info);
          }
          cursor = page.pageInfo?.nextCursor;
        } while (cursor && items.length < 500);
      } catch (error) {
        throw failure(error, "list sandboxes");
      }
      return items;
    },

    destroy,

    async pause(id) {
      try {
        await client.stop({ boxId: id });
      } catch (error) {
        throw failure(error, "stop the sandbox");
      }
    },

    async resume(id) {
      try {
        await client.resume({ boxId: id, resumeRequest: { noEnv: true } });
        await waitUntilReady(client, id);
      } catch (error) {
        throw failure(error, "resume the sandbox");
      }
    },

    async keepAlive(id, timeoutMs) {
      try {
        await client.update({
          boxId: id,
          updateBoxRequest: { ttlSeconds: Math.ceil(timeoutMs / 1000) },
        });
      } catch (error) {
        throw failure(error, "extend the sandbox lifetime");
      }
    },

    async run(id, script, options = {}) {
      await running(id);
      // Boat commands take no environment; values are exported inside the command.
      const exports = Object.entries(options.env ?? {})
        .map(([key, value]) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            throw new Error(`Invalid variable name: ${key}`);
          return `export ${key}=${shellQuote(value)}; `;
        })
        .join("");
      const cd = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : "";
      return command(id, `${exports}${cd}sh -c ${shellQuote(script)}`, options.timeoutMs);
    },

    async writeFile(id, path, data) {
      await running(id);
      const parts: string[] = [];
      try {
        for (let offset = 0; offset < Math.max(1, data.byteLength); offset += WRITE_CHUNK_BYTES) {
          const part = data.byteLength <= WRITE_CHUNK_BYTES ? path : `${path}.part${parts.length}`;
          await client.writeFile({
            boxId: id,
            fileWriteRequest: {
              path: part,
              content: Buffer.from(data.subarray(offset, offset + WRITE_CHUNK_BYTES)).toString(
                "base64",
              ),
              encoding: "base64",
            },
          });
          parts.push(part);
        }
      } catch (error) {
        throw failure(error, "upload a file");
      }
      if (parts.length > 1) {
        const quoted = parts.map(shellQuote).join(" ");
        const joined = await command(id, `cat ${quoted} > ${shellQuote(path)} && rm -f ${quoted}`);
        if (joined.exitCode !== 0)
          throw new SandboxProviderError("provider", "Could not assemble the upload in the box.");
      }
    },

    async readFile(id, path) {
      await running(id);
      try {
        // Boat returns files up to 5 MiB through this API.
        const result = await client.readFile({ boxId: id, path, encoding: "base64" });
        return new Uint8Array(Buffer.from(result.content, "base64"));
      } catch (error) {
        throw failure(error, "download a file");
      }
    },

    async preview(id, port) {
      validatePort(port);
      await running(id);
      // Same as the Boat workspace provider: host the port, then read its protected URL.
      const hosted = await command(id, `host ${port} >/dev/null && host url ${port}`);
      const url = hosted.stdout.match(/https:\/\/\S+/)?.[0];
      if (hosted.exitCode !== 0 || !url)
        throw new SandboxProviderError("provider", `Boat did not return a URL for port ${port}.`);
      // The access token travels as Boat's _port_auth cookie, never in the shown URL.
      const parsed = new URL(url);
      const token = parsed.searchParams.get("_token");
      parsed.searchParams.delete("_token");
      const headers: Record<string, string> = token ? { cookie: `_port_auth=${token}` } : {};
      return { url: parsed.toString(), headers };
    },
  };
}
