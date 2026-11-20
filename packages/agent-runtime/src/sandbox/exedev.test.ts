import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExeDevSandboxTransport } from "./exedev";

const id = "gitterm-sbx-0123456789-01234567";
const transport = createExeDevSandboxTransport({ apiKey: "test-token" });
const scratch = await mkdtemp(path.join(tmpdir(), "gitterm-exedev-"));
// macOS has no setsid; the VM does. Detaching doesn't matter for these tests.
await writeFile(path.join(scratch, "setsid"), '#!/bin/sh\nexec "$@"\n');
await chmod(path.join(scratch, "setsid"), 0o755);

const ndjson = (...frames: object[]) =>
  new Response(frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n");

/**
 * A fake lobby: Bash removes the lobby's quoting, and the VM command runs in a second
 * Bash on this machine. The lobby must pass exactly one argument after the VM name.
 */
function lobby(body: string) {
  const result = Bun.spawnSync(
    ["bash", "-c", `ssh() { [ "$#" = 2 ] || return 99; bash -c "$2"; }\n${body}`],
    { env: { ...process.env, PATH: `${scratch}:${process.env.PATH}` } },
  );
  return ndjson(
    { stdout: Buffer.from(result.stdout).toString("base64") },
    { stderr: Buffer.from(result.stderr).toString("base64") },
    { exit_code: result.exitCode },
  );
}

const requests: string[] = [];
let fetchSpy: ReturnType<typeof spyOn> | undefined;
function mockExec(
  handle: (command: string, headers: Headers) => Response | undefined = () => undefined,
) {
  requests.length = 0;
  const fake = async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(url).toBe("https://exe.dev/exec");
    const command = String(init?.body);
    const headers = new Headers(init?.headers);
    requests.push(command);
    expect(Buffer.byteLength(command)).toBeLessThanOrEqual(64_000);
    const handled = handle(command, headers);
    if (handled) return handled;
    if (command === `ls ${id} --json`)
      return Response.json({ vms: [{ vm_name: id, status: "running" }] });
    if (command.startsWith(`ssh ${id} `)) {
      expect(headers.get("accept")).toBe("application/x-ndjson");
      return lobby(command);
    }
    throw new Error(`unexpected request: ${command.slice(0, 100)}`);
  };
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fake, { preconnect: fetch.preconnect }),
  );
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

test("a command survives both the lobby lexer and the VM shell, with its exit and streams", async () => {
  mockExec();
  const value = `é dollars $HOME, double " and single '\nnext line`;
  const command = `printf '%s\\n' "$PAYLOAD"\nprintf '%s' 'error $literal' >&2\nexit 7`;
  expect(await transport.run(id, command, { env: { PAYLOAD: value } })).toEqual({
    exitCode: 7,
    stdout: `${value}\n`,
    stderr: "error $literal",
  });
});

test("an error frame or a missing exit code is not a command result", async () => {
  mockExec((command) =>
    command.startsWith("ssh ") ? ndjson({ error: "VM did not report an exit status" }) : undefined,
  );
  await expect(transport.run(id, "true")).rejects.toMatchObject({
    code: "provider",
    message: expect.stringContaining("VM did not report an exit status"),
  });
  fetchSpy?.mockRestore();
  mockExec((command) => (command.startsWith("ssh ") ? ndjson({ stdout: "aGk=" }) : undefined));
  await expect(transport.run(id, "true")).rejects.toThrow("did not report the command's exit code");
});

test("a rate-limited request is sent again", async () => {
  let refused = 0;
  mockExec((command) =>
    command.startsWith("ssh ") && refused++ < 2 ? new Response("", { status: 429 }) : undefined,
  );
  expect((await transport.run(id, "echo ok")).stdout).toBe("ok\n");
  expect(refused).toBe(3);
});

test("a command longer than one request runs detached and returns its result", async () => {
  mockExec();
  const result = await transport.run(id, "sleep 1; echo out; echo err >&2; exit 4", {
    timeoutMs: 60_000,
  });
  expect(result).toEqual({ exitCode: 4, stdout: "out\n", stderr: "err\n" });
  const dir = /gitterm-run-[0-9a-f]{16}/.exec(
    requests.find((r) => r.includes("gitterm-run-"))!,
  )![0];
  expect(await readdir("/tmp")).not.toContain(dir);
});

test("files upload exactly, large ones as parallel parts", async () => {
  const small = path.join(scratch, "dir/small.bin");
  const large = path.join(scratch, "dir/large.bin");
  const smallData = randomBytes(1000);
  const largeData = randomBytes(300 * 1024);
  mockExec();
  await transport.writeFile(id, small, smallData);
  await transport.writeFile(id, large, largeData);
  expect(Buffer.compare(await readFile(small), smallData)).toBe(0);
  expect(Buffer.compare(await readFile(large), largeData)).toBe(0);
  // Every part was a separate request, and nothing but the two files is left.
  expect(requests.filter((r) => r.includes("base64 -d >")).length).toBeGreaterThan(6);
  expect((await readdir(path.join(scratch, "dir"))).toSorted()).toEqual(["large.bin", "small.bin"]);
});

test("previews mint one key per VM with a unique label", async () => {
  const labels: string[] = [];
  mockExec((command) => {
    if (command === `rm ${id}`) return Response.json({});
    if (!command.startsWith("ssh-key ")) return;
    expect(command).toStartWith(`ssh-key generate-api-key --vm=${id} `);
    expect(command).toEndWith(" --exp=never");
    labels.push(/--label=(\S+)/.exec(command)![1]!);
    return Response.json({ token: `exe1.test-${labels.length}` });
  });
  const first = createExeDevSandboxTransport({ apiKey: "test-token" });
  const second = createExeDevSandboxTransport({ apiKey: "test-token" });
  expect(await first.preview(id, 3456)).toEqual({
    url: `https://${id}.exe.xyz:3456/`,
    headers: { "X-Exedev-Authorization": "Bearer exe1.test-1" },
  });
  expect((await first.preview(id, 4567)).headers["X-Exedev-Authorization"]).toBe(
    "Bearer exe1.test-1",
  );
  expect((await second.preview(id, 3456)).headers["X-Exedev-Authorization"]).toBe(
    "Bearer exe1.test-2",
  );
  // A destroyed VM's key is never reused for a new VM with the same name.
  await first.destroy(id);
  expect((await first.preview(id, 3456)).headers["X-Exedev-Authorization"]).toBe(
    "Bearer exe1.test-3",
  );
  expect(new Set(labels).size).toBe(3);
});

test("a token without the preview permission gets an error naming it", async () => {
  mockExec((command) =>
    command.startsWith("ssh-key ")
      ? Response.json({ error: "command not allowed by token permissions" }, { status: 403 })
      : undefined,
  );
  await expect(transport.preview(id, 3456)).rejects.toMatchObject({
    code: "auth",
    message: expect.stringContaining('"ssh-key generate-api-key"'),
  });
});

test("a stopped or missing VM is reported from the command itself", async () => {
  mockExec((command) =>
    command.startsWith("ssh ")
      ? Response.json(
          { code: "vm_not_running", error: `VM "${id}" is not running.` },
          { status: 422 },
        )
      : undefined,
  );
  await expect(transport.run(id, "true")).rejects.toMatchObject({
    code: "not_found",
    message: "The exe.dev VM is paused or no longer exists.",
  });
  // One request: no separate status check before the command.
  expect(requests).toHaveLength(1);
});
