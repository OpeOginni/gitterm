import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  accountHash,
  classifyFailure,
  discardFailedCreate,
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
/** exe.dev rejects request bodies over 64 KiB. */
const MAX_BODY_BYTES = 64_000;
/** exe.dev allows 30 s per request; `timeout -k 3` needs a few seconds of that. */
const REQUEST_SECONDS = 25;
/**
 * Each `ssh` request takes about 2 s, mostly session setup, so parts go up in parallel.
 * 16 at a time measured about 6 requests a second, under exe.dev's per-token rate limit.
 */
const UPLOAD_CONCURRENCY = 16;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const DETACHED_OUTPUT_BYTES = 1024 * 1024;

const failed = (step: string, exitCode: number) =>
  new SandboxProviderError("provider", `Could not ${step} the file in the VM (exit ${exitCode}).`);

type VmList = { vms?: Array<{ vm_name: string; status?: string }> };

// The lobby lexes the request body, then the VM shell parses the one argument after the
// VM name. So the whole VM command goes in a single quoted argument.
const sshBody = (id: string, command: string, seconds: number) =>
  `ssh ${id} ${shellQuote(`timeout -k 3 ${seconds} bash -c ${shellQuote(command)}`)}`;

/**
 * An exe.dev VM from a plain image (the default `exeuntu` image ships coding agents).
 * exe.dev has no lifetime or auto-delete, so a VM runs until destroyed. The exec API
 * allows 30 s and 64 KB per request: longer commands run detached and are polled, and
 * uploads are split into parts.
 */
export function createExeDevSandboxTransport(config: {
  apiKey: string;
  image?: string;
  /** Used when no machine profile is given, as exe.dev's `new` flags take them. */
  cpu?: number;
  memory?: string;
  disk?: string;
}): SandboxTransport {
  if (!config.apiKey?.trim()) throw new SandboxProviderError("auth", "exe.dev token is empty.");
  const accessKeys = new Map<string, { token: string; expiresAt: number }>();

  async function exec(command: string, action: string, accept = "text/plain"): Promise<string> {
    if (Buffer.byteLength(command) > MAX_BODY_BYTES)
      throw new SandboxProviderError(
        "provider",
        `The request to ${action} is too large for exe.dev.`,
      );
    const send = async () => {
      try {
        return await fetch("https://exe.dev/exec", {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "text/plain",
            accept,
          },
          body: command,
          signal: AbortSignal.timeout(45_000),
        });
      } catch (error) {
        throw classifyFailure("exe.dev", error, action);
      }
    };
    let response = await send();
    // A rate-limited request was not run, so sending it again is safe. exe.dev sends no
    // Retry-After; its limit recovers within about 15 s.
    for (let attempt = 0; response.status === 429 && attempt < 7; attempt++) {
      await response.body?.cancel();
      await delay(Math.min(15_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2));
      response = await send();
    }
    const text = await response.text();
    if (response.status === 401 || response.status === 403)
      throw new SandboxProviderError(
        "auth",
        `exe.dev rejected the token while trying to ${action}. Tokens need cmds new, ls, ssh, pause, resume, and rm, and "ssh-key generate-api-key" for private previews.`,
      );
    // The VM is checked here rather than with a separate `ls` before each command.
    const vm = !response.ok && /"code":"(vm_not_found|vm_not_running)"/.exec(text)?.[1];
    if (vm)
      throw new SandboxProviderError(
        "not_found",
        vm === "vm_not_found"
          ? "The exe.dev VM no longer exists."
          : "The exe.dev VM is not running.",
      );
    if (response.status === 504)
      throw new SandboxProviderError("timeout", `exe.dev timed out while trying to ${action}.`);
    if (!response.ok)
      throw classifyFailure(
        "exe.dev",
        Object.assign(new Error(`${response.status} ${text.slice(0, 200)}`), {
          status: response.status,
        }),
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

  async function ssh(id: string, command: string, seconds = REQUEST_SECONDS) {
    const text = await exec(sshBody(id, command, seconds), "run a command", "application/x-ndjson");
    // fetch cannot read the X-Exe-Exit trailer. NDJSON gives base64 stdout and stderr
    // frames, then the exit code, or an error when the VM reported no exit status.
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let frame: { stdout?: string; stderr?: string; exit_code?: number; error?: string };
      try {
        frame = JSON.parse(line);
      } catch {
        throw new SandboxProviderError("provider", "exe.dev returned invalid command output.");
      }
      if (typeof frame.error === "string")
        throw new SandboxProviderError(
          "provider",
          `exe.dev could not run the command: ${frame.error}`,
        );
      if (typeof frame.stdout === "string") stdout.push(Buffer.from(frame.stdout, "base64"));
      if (typeof frame.stderr === "string") stderr.push(Buffer.from(frame.stderr, "base64"));
      if (Number.isInteger(frame.exit_code))
        return {
          exitCode: frame.exit_code!,
          stdout: Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString(),
        };
    }
    throw new SandboxProviderError("provider", "exe.dev did not report the command's exit code.");
  }

  /** Runs a command that may outlive one request, then polls for its result. */
  async function runDetached(id: string, command: string, timeoutMs: number) {
    const dir = shellQuote(`/tmp/gitterm-run-${randomBytes(8).toString("hex")}`);
    const launched = await ssh(
      id,
      [
        `set -e; D=${dir}; mkdir -m 700 "$D"`,
        `printf %s ${Buffer.from(command).toString("base64")} | base64 -d > "$D/cmd"`,
        `setsid nohup bash -c 'timeout -k 5 ${Math.ceil(timeoutMs / 1000)} bash "$0/cmd" > "$0/out" 2> "$0/err"; echo $? > "$0/exit.tmp"; mv "$0/exit.tmp" "$0/exit"' "$D" < /dev/null > /dev/null 2>&1 &`,
      ].join("\n"),
    );
    if (launched.exitCode !== 0)
      throw new SandboxProviderError(
        "provider",
        `Could not start the command in the VM. ${launched.stderr.trim().slice(-300)}`,
      );
    // Each poll waits up to 20 s. Exit 75: still running. The result is removed once read.
    const poll = [
      `D=${dir}; end=$((SECONDS + 20))`,
      `while [ -d "$D" ] && [ ! -f "$D/exit" ] && [ "$SECONDS" -lt "$end" ]; do sleep 0.5; done`,
      `[ -d "$D" ] || exit 76`,
      `[ -f "$D/exit" ] || exit 75`,
      `cat "$D/exit"`,
      `tail -c ${DETACHED_OUTPUT_BYTES} "$D/out" | base64 | tr -d '\\n'; echo`,
      `tail -c ${DETACHED_OUTPUT_BYTES} "$D/err" | base64 | tr -d '\\n'; echo`,
      `rm -rf "$D"`,
    ].join("\n");
    const deadline = Date.now() + timeoutMs + 30_000;
    let failures = 0;
    while (Date.now() < deadline) {
      let result;
      try {
        result = await ssh(id, poll);
        failures = 0;
      } catch (error) {
        if (++failures === 3) throw error;
        await delay(1_000);
        continue;
      }
      if (result.exitCode === 75) continue;
      const [code, out, err] = result.stdout.split("\n");
      if (result.exitCode !== 0 || !/^\d+$/.test(code ?? ""))
        throw new SandboxProviderError("provider", "exe.dev lost track of the command.");
      return {
        exitCode: Number(code),
        stdout: Buffer.from(out ?? "", "base64").toString(),
        stderr: Buffer.from(err ?? "", "base64").toString(),
      };
    }
    throw new SandboxProviderError("timeout", "Timed out waiting for the exe.dev command.");
  }

  return {
    provider: "exedev",
    ...profile,

    async create(input) {
      validateLifetime(input.timeoutMs, profile.capabilities.maxLifetimeMs);
      const account = input.labels.gitterm_account ?? input.labels.gitterm_workspace ?? "managed";
      const name = `${NAME_PREFIX}${accountHash(account)}-${randomBytes(4).toString("hex")}`;
      const machine = input.machine ?? config;
      const size = (["cpu", "memory", "disk"] as const)
        .filter((key) => machine[key])
        .map((key) => ` --${key}=${shellQuote(String(machine[key]))}`)
        .join("");
      await exec(
        `new --name=${name} --no-email --image=${shellQuote(input.template ?? config.image ?? DEFAULT_EXEDEV_SANDBOX_IMAGE)}${size} --json`,
        "create a sandbox",
      );
      try {
        const deadline = Date.now() + 120_000;
        while ((await info(name)).state !== "running") {
          if (Date.now() > deadline)
            throw new SandboxProviderError("timeout", "Timed out waiting for the exe.dev VM.");
          await delay(1_000);
        }
        const check = await ssh(name, "true");
        if (check.exitCode !== 0) throw new Error("VM did not run a command");
        return info(name);
      } catch (error) {
        return discardFailedCreate(() => exec(`rm ${name}`, "delete the sandbox"), name, error);
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
      accessKeys.delete(id);
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
      const exports = Object.entries(options.env ?? {})
        .map(([key, value]) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            throw new Error(`Invalid variable name: ${key}`);
          return `export ${key}=${shellQuote(value)}; `;
        })
        .join("");
      const cd = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : "";
      const timeoutMs = options.timeoutMs ?? REQUEST_SECONDS * 1000;
      if (timeoutMs > 30_000) return runDetached(id, `${exports}${cd}${command}`, timeoutMs);
      const seconds = Math.max(1, Math.min(REQUEST_SECONDS, Math.floor(timeoutMs / 1000)));
      return ssh(id, `${exports}${cd}${command}`, seconds);
    },

    async writeFile(id, path, data) {
      const target = shellQuote(path);
      const encode = (from: number, to: number) =>
        Buffer.from(data.subarray(from, to)).toString("base64");
      // The most file bytes a script fits in one request, as base64 in place of "".
      const capacity = (script: (content: string) => string) =>
        Math.floor(
          (MAX_BODY_BYTES - Buffer.byteLength(sshBody(id, script(""), REQUEST_SECONDS))) / 4,
        ) * 3;
      const whole = (content: string) =>
        `mkdir -p "$(dirname ${target})" && printf %s ${content} | base64 -d > ${target}`;
      if (data.byteLength <= capacity(whole)) {
        const written = await ssh(id, whole(encode(0, data.byteLength)));
        if (written.exitCode !== 0)
          throw new SandboxProviderError("provider", "Could not upload the file to the VM.");
        return;
      }

      // Larger files go up as numbered parts in parallel, then are joined in order.
      const parts = shellQuote(`${path}.gitterm-${randomBytes(8).toString("hex")}`);
      const part = (index: number) => (content: string) =>
        `printf %s ${content} | base64 -d > ${parts}/${String(index).padStart(6, "0")}`;
      const partBytes = capacity(part(0));
      if (partBytes < 1024)
        throw new SandboxProviderError("provider", "The upload path is too long for exe.dev.");
      const count = Math.ceil(data.byteLength / partBytes);
      let next = 0;
      let stop = false;
      async function worker() {
        while (!stop && next < count) {
          const index = next++;
          const content = encode(index * partBytes, (index + 1) * partBytes);
          // Writing a part again replaces it, so a failed part can be resent.
          for (let attempt = 1; ; attempt++) {
            const result = await ssh(id, part(index)(content)).catch((error: Error) => error);
            if (!(result instanceof Error) && result.exitCode === 0) break;
            if (attempt === 3)
              throw result instanceof Error ? result : failed("upload", result.exitCode);
            await delay(1_000 * attempt);
          }
        }
      }
      try {
        const begin = await ssh(id, `mkdir -p "$(dirname ${target})" && mkdir -m 700 ${parts}`);
        if (begin.exitCode !== 0) throw failed("start uploading", begin.exitCode);
        // Let every worker stop before the parts are removed.
        const results = await Promise.allSettled(
          Array.from({ length: Math.min(UPLOAD_CONCURRENCY, count) }, () =>
            worker().catch((error) => {
              stop = true;
              throw error;
            }),
          ),
        );
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
        const joined = await ssh(
          id,
          [
            `cat ${parts}/* > ${target}.tmp`,
            `[ "$(wc -c < ${target}.tmp)" -eq ${data.byteLength} ] || exit 9`,
            `mv -f ${target}.tmp ${target}`,
            `rm -rf ${parts}`,
          ].join(" && "),
        );
        if (joined.exitCode !== 0) throw failed("join", joined.exitCode);
      } catch (error) {
        await ssh(id, `rm -rf ${parts} ${target}.tmp`).catch(() => {});
        throw error;
      }
    },

    async readFile(id, path) {
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
      let key = accessKeys.get(id);
      if (!key || key.expiresAt < Date.now() + 60 * 60_000) {
        // A VM-scoped key kept only in this process's memory. Labels must be unique per
        // account. exe.dev turns `--exp=never` into 30 days for VM keys.
        const output = await exec(
          `ssh-key generate-api-key --vm=${id} --label=gitterm-sandbox-${randomBytes(8).toString("hex")} --exp=never`,
          "create a preview key",
        );
        let minted: { token?: string; expires_at?: string } = {};
        try {
          minted = JSON.parse(output);
        } catch {
          // Never put a response that may hold a credential in an error.
        }
        if (typeof minted.token !== "string" || !minted.token)
          throw new SandboxProviderError("provider", "exe.dev did not return a VM access key.");
        key = { token: minted.token, expiresAt: Date.parse(minted.expires_at ?? "") || Infinity };
        accessKeys.set(id, key);
      }
      return {
        url: `https://${id}.exe.xyz:${port}/`,
        headers: { "X-Exedev-Authorization": `Bearer ${key.token}` },
      };
    },
  };
}
