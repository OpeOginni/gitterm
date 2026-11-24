import { afterAll, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { moveToCloud, returnFromCloud, type Cloud } from "../flows.js";
import { loadRecords } from "../records.js";
import type { ExportedSession } from "./types.js";
import { opencodeAgent, opencodeMachine } from "./opencode.js";

test("only a user message after the move counts as local work", () => {
  const session = (types: string[]) =>
    ({ payload: { messages: types.map((type) => ({ type })) } }) as unknown as ExportedSession;
  expect(opencodeAgent.sentSince(session(["user", "assistant", "agent-switched"]), 2)).toBe(false);
  expect(opencodeAgent.sentSince(session(["user", "assistant", "user"]), 2)).toBe(true);
  expect(opencodeAgent.currentSession({ OPENCODE_SESSION_ID: "ses_1" })).toBe("ses_1");
});

test("a failed import puts back the session it was replacing", async () => {
  const original = {
    info: { id: "ses_1", location: { directory: "/repo" } },
    messages: [{ type: "user" }],
  };
  const sessions = new Map<string, unknown>([["ses_1", original]]);
  let failNext = true;
  const opencode = {
    session: {
      export: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID),
      fork: async () => {},
      remove: async ({ sessionID }: { sessionID: string }) => sessions.delete(sessionID),
      import: async (input: { info: { id: string } }) => {
        if (failNext) {
          failNext = false;
          throw new Error("import failed");
        }
        sessions.set(input.info.id, input);
        return { id: input.info.id };
      },
    },
  } as unknown as OpenCodeClient;
  const incoming = { info: { id: "ses_1" }, messages: [{ type: "user" }, { type: "assistant" }] };
  await expect(
    opencodeAgent
      .session(opencodeMachine(opencode))
      .import({ payload: incoming, cwd: "/repo", ref: "ses_1" }),
  ).rejects.toThrow("import failed");
  expect(sessions.get("ses_1")).toMatchObject(original);
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

test.skipIf(!withOpencode)(
  "a session goes to a workspace and comes back with what was done there",
  async () => {
    const local = await serve("from", 47943);
    const cloud = await serve("to", 47944);
    const home = process.env.HOME;
    process.env.HOME = path.join(root, "home");
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], {
        cwd,
        encoding: "utf8",
      }).stdout.trim();
    try {
      writeFileSync(path.join(local.repo, "a.txt"), "one\n");
      git(local.repo, "add", ".");
      git(local.repo, "commit", "-qm", "one");
      writeFileSync(path.join(local.repo, "a.txt"), "uncommitted\n");
      const session = await local.client.session.create({
        location: { directory: local.repo },
        title: "round trip",
      });
      const ends: string[] = [];
      // GitTerm, with a workspace that is the second OpenCode server.
      const gitterm: Cloud = {
        create: async () => "ws-1",
        ready: async () => ({
          url: cloud.url,
          directory: cloud.repo,
          password: cloud.password,
          canExec: false,
        }),
        machine: () => {
          throw new Error("The move should go through OpenCode.");
        },
        end: async (_id, how) => {
          ends.push(how);
        },
      };
      const deps = {
        cloud: gitterm,
        local: opencodeMachine(local.client),
        agent: opencodeAgent,
        progress: () => {},
      };
      const there = opencodeAgent.session(
        opencodeAgent.remote!({ ...cloud, directory: cloud.repo }),
      );
      // The notice starts a turn, which waits for a model the test has none of: stop it.
      const atRest = () => there.stop!({ ref: session.id });

      const moved = await moveToCloud(deps, {
        ref: session.id,
        changes: true,
        fromSession: false,
      });
      expect(moved.workspaceId).toBe("ws-1");
      expect(readFileSync(path.join(cloud.repo, "a.txt"), "utf8")).toBe("uncommitted\n");
      expect(git(cloud.repo, "log", "--format=%s")).toBe("one");
      await atRest();

      // Work done in the cloud.
      writeFileSync(path.join(cloud.repo, "b.txt"), "from the cloud\n");
      git(cloud.repo, "add", ".");
      git(cloud.repo, "commit", "-qm", "two");

      const [record] = await loadRecords();
      await returnFromCloud(deps, record!, { force: false, end: "delete" });
      expect(readFileSync(path.join(local.repo, "b.txt"), "utf8")).toBe("from the cloud\n");
      expect(git(local.repo, "log", "--format=%s")).toBe("two\none");
      expect(ends).toEqual(["delete"]);
      expect((await loadRecords())[0]?.returnedAt).toBeString();
    } finally {
      process.env.HOME = home;
    }
  },
  240_000,
);
