import { afterAll, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenCode } from "@opencode/client";
import type { ExportedSession } from "./types.js";
import { opencodeAgent, opencodeMachine } from "./opencode.js";

test("only a user message after the move counts as local work", () => {
  const session = (types: string[]) =>
    ({ payload: { messages: types.map((type) => ({ type })) } }) as unknown as ExportedSession;
  expect(opencodeAgent.sentSince(session(["user", "assistant", "agent-switched"]), 2)).toBe(false);
  expect(opencodeAgent.sentSince(session(["user", "assistant", "user"]), 2)).toBe(true);
  expect(opencodeAgent.currentSession({ OPENCODE_SESSION_ID: "ses_1" })).toBe("ses_1");
});

/**
 * Two real OpenCode servers, with their own data folders, stand for this machine and a
 * workspace. The workspace is reached only through its OpenCode server: files and commands go
 * through OpenCode's file and shell APIs, as on a provider without GitTerm's command endpoint.
 * Opt in, with `opencode` installed: GITTERM_OPENCODE_TESTS=1. No model is called.
 */
const withOpencode =
  process.env.GITTERM_OPENCODE_TESTS === "1" && spawnSync("opencode", ["--version"]).status === 0;
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "gitterm-opencode-")));
const servers: ChildProcess[] = [];
afterAll(() => {
  for (const server of servers) server.kill("SIGTERM");
  rmSync(root, { recursive: true, force: true });
});

async function serve(name: string, port: number) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, "repo"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: path.join(dir, "repo") });
  const password = `pw-${name}`;
  servers.push(
    spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: path.join(dir, "repo"),
      env: {
        ...process.env,
        OPENCODE_PASSWORD: password,
        XDG_DATA_HOME: path.join(dir, "data"),
        XDG_STATE_HOME: path.join(dir, "state"),
        XDG_CONFIG_HOME: path.join(dir, "config"),
        XDG_CACHE_HOME: path.join(dir, "cache"),
      },
      stdio: "ignore",
    }),
  );
  const url = `http://127.0.0.1:${port}`;
  const client = OpenCode.make({
    baseUrl: url,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
  });
  for (let i = 0; i < 60; i++) {
    if (
      await client.server.info().then(
        () => true,
        () => false,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { client, url, password, repo: path.join(dir, "repo") };
}

test.skipIf(!withOpencode)(
  "an OpenCode session moves into a workspace reached only through its OpenCode server",
  async () => {
    const local = await serve("local", 47941);
    const cloud = await serve("cloud", 47942);
    const session = await local.client.session.create({
      location: { directory: local.repo },
      title: "fig test",
    });

    const here = opencodeAgent.session(opencodeMachine(local.client));
    expect((await here.info()).version).toMatch(/\d+\.\d+\.\d+/);
    const exported = await here.export({ ref: session.id });
    expect(exported).toMatchObject({ ref: session.id, cwd: local.repo, title: "fig test" });

    const remote = opencodeAgent.remote!({
      url: cloud.url,
      directory: cloud.repo,
      password: cloud.password,
    });
    // GitTerm's checkout transfer works through OpenCode alone.
    await remote.writeFile(path.join(cloud.repo, "probe.bin"), Buffer.from("through opencode"));
    expect((await remote.readFile(path.join(cloud.repo, "probe.bin"))).toString()).toBe(
      "through opencode",
    );
    expect(
      await remote.script(cloud.repo, "process.stdout.write(process.argv[1]); process.exit(3)", [
        "a b",
      ]),
    ).toEqual({ exit: 3, stdout: "a b" });

    const there = opencodeAgent.session(remote);
    const imported = await there.import({ payload: exported.payload, cwd: cloud.repo });
    expect(imported.ref).toBe(session.id);
    expect((await there.export({ ref: imported.ref })).cwd).toBe(cloud.repo);
    expect((await there.status({ ref: imported.ref })).busy).toBe(false);
  },
  180_000,
);
