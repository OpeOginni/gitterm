import { randomBytes } from "node:crypto";
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

const profile = SANDBOX_PROVIDER_PROFILES.exedev;
export const DEFAULT_EXEDEV_SANDBOX_IMAGE = "node:22-bookworm";
const NAME_PREFIX = "gitterm-sbx-";
const EXIT_MARKER = "__GITTERM_EXIT__";
/** exe.dev's exec API accepts 64 KB request bodies; base64 chunks stay well below it. */
const WRITE_CHUNK_BYTES = 40 * 1024;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

type VmList = { vms?: Array<{ vm_name: string; status?: string }> };

/**
 * An exe.dev VM from a plain image (the default `exeuntu` image ships coding agents).
 * exe.dev has no lifetime or auto-delete, so a VM runs until destroyed. The exec API
 * allows 30 s and 64 KB per request: jobs launch detached and uploads are chunked.
 */
export function createExeDevSandboxTransport(config: {
  apiKey: string;
  image?: string;
}): SandboxTransport {
  if (!config.apiKey?.trim()) throw new SandboxProviderError("auth", "exe.dev token is empty.");
  const accessKeys = new Map<string, string>();

  async function exec(command: string, action: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch("https://exe.dev/exec", {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "text/plain" },
        body: command,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      throw classifyFailure("exe.dev", error, action);
    }
    const text = await response.text();
    if (response.status === 401 || response.status === 403)
      throw new SandboxProviderError(
        "auth",
        `exe.dev rejected the token while trying to ${action}. Tokens need cmds new, ls, ssh, ssh-key, pause, resume, and rm.`,
      );
    if (response.status === 504)
      throw new SandboxProviderError("timeout", `exe.dev timed out while trying to ${action}.`);
    if (!response.ok)
      throw classifyFailure(
        "exe.dev",
        new Error(`${response.status} ${text.slice(0, 200)}`),
        action,
      );
    return text;
  }

  const parseList = (text: string): VmList => {
    try {
      return JSON.parse(text) as VmList;
    } catch {
      return {};
    }
  };

  const infoFrom = (name: string, status: string | undefined): SandboxProviderInfo => {
    const match = new RegExp(`^${NAME_PREFIX}([a-f0-9]{10})-`).exec(name);
    return {
      id: name,
      state:
        status === "running"
          ? "running"
          : status === "paused"
            ? "paused"
            : status === "creating"
              ? "pending"
              : "terminated",
      labels: match ? { gitterm_account_hash: match[1]!, gitterm_workload: "sandbox" } : {},
      startedAt: null,
      expiresAt: null,
    };
  };

  async function info(id: string): Promise<SandboxProviderInfo> {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid exe.dev VM name");
    try {
      const vm = parseList(await exec(`ls ${id} --json`, "read the sandbox")).vms?.find(
        (item) => item.vm_name === id,
      );
      return vm ? infoFrom(id, vm.status) : terminated(id);
    } catch (error) {
      if (error instanceof SandboxProviderError && error.code === "not_found")
        return terminated(id);
      throw error;
    }
  }

  async function ssh(id: string, command: string, timeoutMs = 25_000) {
    const text = await exec(
      `ssh ${id} -- bash -c ${shellQuote(`timeout ${Math.max(1, Math.floor(timeoutMs / 1000))} bash -c ${shellQuote(command)}; printf '\\n${EXIT_MARKER}%s\\n' "$?"`)}`,
      "run a command",
    );
    const match = new RegExp(`\\n?${EXIT_MARKER}(\\d+)\\n?$`).exec(text);
    if (!match)
      throw new SandboxProviderError("provider", "exe.dev did not report the command's exit code.");
    // exe.dev returns stdout and stderr combined.
    return { exitCode: Number(match[1]), stdout: text.slice(0, match.index), stderr: "" };
  }

  async function running(id: string) {
    const current = await info(id);
    if (current.state !== "running")
      throw new SandboxProviderError("not_found", `The exe.dev VM is ${current.state}.`);
  }

  return {
    provider: "exedev",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const account = input.labels.gitterm_account ?? input.labels.gitterm_workspace ?? "managed";
      const name = `${NAME_PREFIX}${accountHash(account)}-${randomBytes(4).toString("hex")}`;
      await exec(
        `new --name=${name} --no-email --image=${shellQuote(input.template ?? config.image ?? DEFAULT_EXEDEV_SANDBOX_IMAGE)} --json`,
        "create a sandbox",
      );
      try {
        const deadline = Date.now() + 120_000;
        while ((await info(name)).state !== "running") {
          if (Date.now() > deadline)
            throw new SandboxProviderError("timeout", "Timed out waiting for the exe.dev VM.");
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const check = await ssh(name, "true");
        if (check.exitCode !== 0) throw new Error("VM did not run a command");
        return info(name);
      } catch (error) {
        await exec(`rm ${name}`, "delete the sandbox").catch(() => {});
        throw error;
      }
    },

    info,

    async list(labels) {
      const wanted = labels.gitterm_account ? accountHash(labels.gitterm_account) : undefined;
      return (parseList(await exec("ls --json", "list sandboxes")).vms ?? [])
        .filter((vm) => vm.vm_name.startsWith(wanted ? `${NAME_PREFIX}${wanted}-` : NAME_PREFIX))
        .map((vm) => infoFrom(vm.vm_name, vm.status))
        .filter((item) => item.state !== "terminated");
    },

    async destroy(id) {
      if ((await info(id)).state === "terminated") return;
      await exec(`rm ${id}`, "delete the sandbox");
    },

    async pause(id) {
      await exec(`pause ${id}`, "pause the sandbox");
    },

    async resume(id) {
      await exec(`resume ${id}`, "resume the sandbox");
    },

    async run(id, command, options = {}) {
      await running(id);
      const exports = Object.entries(options.env ?? {})
        .map(([key, value]) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            throw new Error(`Invalid variable name: ${key}`);
          return `export ${key}=${shellQuote(value)}; `;
        })
        .join("");
      const cd = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : "";
      // The exec API allows 30 s per request; longer work belongs in jobs.
      return ssh(id, `${exports}${cd}${command}`, Math.min(options.timeoutMs ?? 25_000, 25_000));
    },

    async writeFile(id, path, data) {
      await running(id);
      const target = shellQuote(path);
      const begin = await ssh(id, `mkdir -p "$(dirname ${target})" && : > ${target}`);
      if (begin.exitCode !== 0)
        throw new SandboxProviderError("provider", "Could not create the file in the VM.");
      for (let offset = 0; offset < data.byteLength; offset += WRITE_CHUNK_BYTES) {
        const chunk = Buffer.from(data.subarray(offset, offset + WRITE_CHUNK_BYTES)).toString(
          "base64",
        );
        const appended = await ssh(id, `printf %s ${chunk} | base64 -d >> ${target}`);
        if (appended.exitCode !== 0)
          throw new SandboxProviderError("provider", "Could not upload the file to the VM.");
      }
    },

    async readFile(id, path) {
      await running(id);
      const size = await ssh(id, `wc -c < ${shellQuote(path)}`);
      if (size.exitCode !== 0)
        throw new SandboxProviderError("not_found", `No file at ${path} in the VM.`);
      const total = Number(size.stdout.trim());
      const chunks: Buffer[] = [];
      for (let block = 0; block * READ_CHUNK_BYTES < total; block++) {
        const part = await ssh(
          id,
          `dd if=${shellQuote(path)} bs=${READ_CHUNK_BYTES} skip=${block} count=1 2>/dev/null | base64 -w0`,
        );
        if (part.exitCode !== 0)
          throw new SandboxProviderError("provider", "Could not download the file from the VM.");
        chunks.push(Buffer.from(part.stdout.trim(), "base64"));
      }
      return new Uint8Array(Buffer.concat(chunks));
    },

    async preview(id, port) {
      validatePort(port);
      if (port < 3000 || port > 9999) throw new Error("exe.dev previews support ports 3000-9999");
      await running(id);
      let key = accessKeys.get(id);
      if (!key) {
        // A VM-scoped key kept only in this process's memory.
        const output = await exec(
          `ssh-key generate-api-key --vm=${id} --label=gitterm-sandbox --exp=never`,
          "create a preview key",
        );
        key = output.match(/exe[01]\.[A-Za-z0-9._-]+/)?.[0];
        if (!key)
          throw new SandboxProviderError("provider", "exe.dev did not return a VM access key.");
        accessKeys.set(id, key);
      }
      return {
        url: `https://${id}.exe.xyz:${port}/`,
        headers: { "X-Exedev-Authorization": `Bearer ${key}` },
      };
    },
  };
}
