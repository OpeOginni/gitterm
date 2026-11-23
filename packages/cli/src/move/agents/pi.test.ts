import { afterAll, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PI_EXTENSION, PI_EXTENSION_PATH } from "@gitterm/schema/pi";
import { localMachine } from "../machine.js";
import type { ExportedSession } from "./types.js";
import { piAgent, piSentSince } from "./pi.js";

// Pi keeps real paths (macOS puts temp folders under /private).
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "gitterm-pi-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Two Pi homes standing for this machine and a workspace. */
const homes = (name: string) => {
  const dir = path.join(root, name);
  const repo = path.join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const agentDir = path.join(dir, "agent");
  return { repo, agentDir, machine: localMachine({ PI_CODING_AGENT_DIR: agentDir }) };
};

const ID = "11111111-2222-4333-8444-555555555555";
const entry = (id: string, parentId: string | null, message: Record<string, unknown>) =>
  JSON.stringify({ type: "message", id, parentId, timestamp: "2026-11-23T10:00:00.000Z", message });
const user = (id: string, parentId: string | null, text: string) =>
  entry(id, parentId, { role: "user", content: text, timestamp: 1 });
const assistant = (id: string, parentId: string, text: string) =>
  entry(id, parentId, {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    stopReason: "stop",
    timestamp: 2,
  });

/** A session Pi wrote for `cwd`, as its files look on disk. */
function writeSession(agentDir: string, cwd: string) {
  const dir = path.join(agentDir, "sessions", `--${cwd.slice(1).replace(/[/\\:]/g, "-")}--`);
  mkdirSync(dir, { recursive: true });
  const header = {
    type: "session",
    version: 3,
    id: ID,
    timestamp: "2026-11-23T10:00:00.000Z",
    cwd,
  };
  const file = path.join(dir, `2026-11-23T10-00-00-000Z_${ID}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify(header),
      user("a1b2c3d4", null, "The test word is KIWI-7. Remember it."),
      assistant("b2c3d4e5", "a1b2c3d4", "Noted: KIWI-7."),
    ].join("\n") + "\n",
  );
  return file;
}

test("a Pi session moves to another directory and comes back into the same session", async () => {
  const here = homes("here");
  const there = homes("there");
  const original = writeSession(here.agentDir, here.repo);

  const exported = await here.machine.agent<ExportedSession>(piAgent.script, "export", { ref: ID });
  expect(exported).toMatchObject({
    ref: ID,
    cwd: here.repo,
    title: "The test word is KIWI-7. Remember it.",
  });

  // A new session there, for its own directory, under Pi's folder for that directory.
  const imported = await there.machine.agent<{ ref: string; file: string }>(
    piAgent.script,
    "import",
    {
      payload: exported.payload,
      cwd: there.repo,
    },
  );
  expect(imported.ref).not.toBe(ID);
  expect(path.dirname(imported.file)).toBe(
    path.join(there.agentDir, "sessions", `--${there.repo.slice(1).replace(/[/\\:]/g, "-")}--`),
  );
  const [header, ...rest] = readFileSync(imported.file, "utf8").trim().split("\n");
  expect(JSON.parse(header!)).toMatchObject({ id: imported.ref, cwd: there.repo });
  expect(rest).toHaveLength(2);

  // The cloud goes on; the session comes back into the original one, keeping a copy.
  writeFileSync(
    imported.file,
    `${readFileSync(imported.file, "utf8")}${user("c3d4e5f6", "b2c3d4e5", "Create cloud.txt.")}\n${assistant("d4e5f6a7", "c3d4e5f6", "Created cloud.txt.")}\n`,
  );
  const back = await there.machine.agent<ExportedSession>(piAgent.script, "export", {
    ref: imported.ref,
  });
  await here.machine.agent(piAgent.script, "import", {
    ref: ID,
    payload: back.payload,
    cwd: here.repo,
  });
  const returned = readFileSync(original, "utf8").trim().split("\n");
  expect(JSON.parse(returned[0]!)).toMatchObject({ id: ID, cwd: here.repo });
  expect(returned).toHaveLength(5);
  expect(readdirSync(path.dirname(original)).some((name) => name.includes(".gitterm-"))).toBe(true);

  // A notice waits in Pi's inbox for the extension; locally, nothing else starts.
  const notified = await here.machine.agent<{ started: boolean }>(piAgent.script, "notify", {
    ref: ID,
    message: "Back from the cloud.",
    where: "local",
  });
  expect(notified.started).toBe(false);
  expect(readFileSync(path.join(here.agentDir, "gitterm", "inbox", `${ID}.txt`), "utf8")).toBe(
    "Back from the cloud.",
  );
});

test("only a user message after the move counts as local work", () => {
  const before = `${user("a", null, "move this")}\n`;
  expect(piSentSince(`${before}${assistant("b", "a", "Moved.")}\n`, before.length)).toBe(false);
  expect(piSentSince(`${before}${user("c", "a", "more")}\n`, before.length)).toBe(true);
});

test("returning a Pi session from inside Pi is refused with what to do instead", () => {
  expect(piAgent.currentSession({ PI_SESSION_ID: ID })).toBe(ID);
  expect(piAgent.insideReturn).toContain("/cloud-return");
});

/**
 * The real Pi opens a moved session with its history, and GitTerm's extension hands Pi the
 * notice left for it. Opt in, with `pi` installed: GITTERM_PI_TESTS=1. No model is called
 * successfully: the test Pi has no credentials, so the notice's turn fails after it is sent.
 */
const withPi = process.env.GITTERM_PI_TESTS === "1" && spawnSync("pi", ["--version"]).status === 0;
test.skipIf(!withPi)(
  "Pi resumes a moved session and receives its notice",
  async () => {
    const here = homes("pi-here");
    const there = homes("pi-there");
    writeSession(here.agentDir, here.repo);
    const exported = await here.machine.agent<ExportedSession>(piAgent.script, "export", {
      ref: ID,
    });
    const imported = await there.machine.agent<{ ref: string; file: string }>(
      piAgent.script,
      "import",
      {
        payload: exported.payload,
        cwd: there.repo,
      },
    );
    mkdirSync(path.dirname(path.join(there.agentDir, PI_EXTENSION_PATH)), { recursive: true });
    writeFileSync(path.join(there.agentDir, PI_EXTENSION_PATH), PI_EXTENSION);
    await there.machine.agent(piAgent.script, "notify", {
      ref: imported.ref,
      message: "GITTERM-NOTICE",
      where: "local",
    });

    const pi = spawn("pi", ["--mode", "rpc", "--session", imported.file], {
      cwd: there.repo,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: there.agentDir,
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
      },
    });
    let out = "";
    pi.stdout.on("data", (chunk) => (out += chunk));
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      pi.stdin.write(`${JSON.stringify({ id: "m", type: "get_messages" })}\n`);
      for (let i = 0; i < 50 && !out.includes('"id":"m"'); i++)
        await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      pi.kill("SIGTERM");
    }
    const response = out
      .split("\n")
      .filter(Boolean)
      .map(
        (line) => JSON.parse(line) as { id?: string; data?: { messages: Array<{ role: string }> } },
      )
      .find((event) => event.id === "m");
    expect(response?.data?.messages.map((message) => message.role).slice(0, 2)).toEqual([
      "user",
      "assistant",
    ]);
    expect(existsSync(path.join(there.agentDir, "gitterm", "inbox", `${imported.ref}.txt`))).toBe(
      false,
    );
  },
  30_000,
);
