import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENCODE_SERVICE_REGISTRAR_SCRIPT,
  isOpencodeServeCommand,
  opencodeServeCommand,
} from "./opencode-service";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0)) await step();
});

test("registers the running server from its /api/info", async () => {
  const home = await mkdtemp(join(tmpdir(), "opencode-service-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      request.headers.get("authorization") === `Basic ${btoa("opencode:secret")}`
        ? Response.json({ version: "2.0.24", pid: 4242 })
        : new Response("unauthorized", { status: 401 }),
  });
  cleanup.push(async () => void server.stop(true));
  const script = join(home, "register-service.sh");
  await writeFile(script, OPENCODE_SERVICE_REGISTRAR_SCRIPT);

  // Async: the fake server runs in this process and must keep answering.
  const child = Bun.spawn(["sh", script, String(server.port)], {
    env: { PATH: process.env.PATH, HOME: home, OPENCODE_SERVER_PASSWORD: "secret" },
  });

  expect(await child.exited).toBe(0);
  const file = join(home, ".local/state/opencode/service.json");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    url: `http://127.0.0.1:${server.port}`,
    pid: 4242,
    version: "2.0.24",
    password: "secret",
  });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
});

test("the serve command still reads as an OpenCode server", () => {
  const command = opencodeServeCommand(4096);
  expect(command).toContain('"$HOME/.gitterm/opencode/register-service.sh" 4096');
  expect(command).toContain("exec opencode serve --hostname 0.0.0.0 --port 4096");
  expect(isOpencodeServeCommand(command)).toBe(true);
  expect(isOpencodeServeCommand("opencode serve --hostname 0.0.0.0 --port 4096")).toBe(true);
  expect(isOpencodeServeCommand("t3 serve --port 4096")).toBe(false);
});
