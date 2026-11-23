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

  const exported = await here.machine.agent<ExportedSession>(piAgent.script!, "export", {
    ref: ID,
  });
  expect(exported).toMatchObject({
    ref: ID,
    cwd: here.repo,
    title: "The test word is KIWI-7. Remember it.",
  });

  // A new session there, for its own directory, under Pi's folder for that directory.
  const imported = await there.machine.agent<{ ref: string; file: string }>(
    piAgent.script!,
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
  const back = await there.machine.agent<ExportedSession>(piAgent.script!, "export", {
    ref: imported.ref,
  });
  await here.machine.agent(piAgent.script!, "import", {
    ref: ID,
    payload: back.payload,
    cwd: here.repo,
  });
  const returned = readFileSync(original, "utf8").trim().split("\n");
  expect(JSON.parse(returned[0]!)).toMatchObject({ id: ID, cwd: here.repo });
  expect(returned).toHaveLength(5);
  expect(readdirSync(path.dirname(original)).some((name) => name.includes(".gitterm-"))).toBe(true);

  // A notice waits in Pi's inbox for the extension; locally, nothing else starts.
  const notified = await here.machine.agent<{ started: boolean }>(piAgent.script!, "notify", {
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
    const exported = await here.machine.agent<ExportedSession>(piAgent.script!, "export", {
      ref: ID,
    });
    const imported = await there.machine.agent<{ ref: string; file: string }>(
      piAgent.script!,
      "import",
      {
        payload: exported.payload,
        cwd: there.repo,
      },
    );
    mkdirSync(path.dirname(path.join(there.agentDir, PI_EXTENSION_PATH)), { recursive: true });
    writeFileSync(path.join(there.agentDir, PI_EXTENSION_PATH), PI_EXTENSION);
    await there.machine.agent(piAgent.script!, "notify", {
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

/**
 * GitTerm's extension in a real Pi, driven over RPC, with a stand-in `gitterm` that records how
 * it is called. Opt in, with `pi` installed: GITTERM_PI_TESTS=1.
 */
test.skipIf(!withPi)(
  "Pi's /cloud and /cloud-return ask first, show where the session is, and run gitterm",
  async () => {
    const here = homes("pi-extension");
    const home = path.join(root, "pi-extension", "home");
    const bin = path.join(root, "pi-extension", "bin");
    const calls = path.join(root, "pi-extension", "calls.txt");
    mkdirSync(bin, { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: here.repo });
    writeFileSync(path.join(here.repo, "edited.txt"), "uncommitted\n");
    const sessionFile = writeSession(here.agentDir, here.repo);
    mkdirSync(path.dirname(path.join(here.agentDir, PI_EXTENSION_PATH)), { recursive: true });
    writeFileSync(path.join(here.agentDir, PI_EXTENSION_PATH), PI_EXTENSION);
    // `move` records the session as moved; `return` wants --force, then marks it returned.
    const records = path.join(home, ".config", "gitterm", "moves.json");
    writeFileSync(
      path.join(bin, "gitterm"),
      `#!/bin/sh
echo "$*" >> ${JSON.stringify(calls)}
mkdir -p ${JSON.stringify(path.dirname(records))}
case "$1" in
  move)
    echo '[{"agent":"pi","localRef":"${ID}","workspaceId":"ws-1"}]' > ${JSON.stringify(records)}
    echo '{"workspaceId":"ws-1","links":{"Pi":"https://ws-1.example"},"warnings":[]}' ;;
  return)
    case "$*" in
      *--force*)
        echo '[{"agent":"pi","localRef":"${ID}","workspaceId":"ws-1","returnedAt":"now"}]' > ${JSON.stringify(records)}
        echo '{"ref":"${ID}"}' ;;
      *) echo '{"error":{"code":"NEEDS_CONFIRMATION","message":"Run again with --force."}}' >&2; exit 1 ;;
    esac ;;
esac
`,
      { mode: 0o755 },
    );

    const pi = spawn("pi", ["--mode", "rpc", "--session", sessionFile], {
      cwd: here.repo,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        // Pi wants a key before extensions see a prompt; nothing is sent with it.
        ANTHROPIC_API_KEY: "sk-ant-test",
        PI_CODING_AGENT_DIR: here.agentDir,
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
      },
    });
    type UiRequest = {
      type: string;
      id: string;
      method: string;
      title?: string;
      options?: string[];
      statusText?: string;
      text?: string;
      message?: { content?: string };
    };
    const events: UiRequest[] = [];
    let buffer = "";
    pi.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) if (line.trim()) events.push(JSON.parse(line) as UiRequest);
    });
    const send = (command: Record<string, unknown>) =>
      pi.stdin.write(`${JSON.stringify(command)}\n`);
    let seen = 0;
    /** The next event after the last one taken that matches. */
    const next = async (match: (event: UiRequest) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const index = events.findIndex((event, at) => at >= seen && match(event));
        if (index >= 0) {
          seen = index + 1;
          return events[index]!;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`No matching event in: ${JSON.stringify(events.slice(seen))}`);
    };
    const ui = (method: string) => (event: UiRequest) =>
      event.type === "extension_ui_request" && event.method === method;
    const status = (event: UiRequest) =>
      ui("setStatus")(event) &&
      event.statusText !== "Moving to the cloud…" &&
      event.statusText !== "Bringing it back from the cloud…";
    try {
      // At startup the session is here: no status.
      expect((await next(ui("setStatus"))).statusText).toBeUndefined();

      send({ type: "prompt", message: "/cloud finish the tests" });
      const changes = await next(ui("select"));
      expect(changes.title).toBe("Bring your uncommitted changes to the cloud?");
      send({ type: "extension_ui_response", id: changes.id, value: changes.options![1] });
      expect((await next(status)).statusText).toContain("In a GitTerm cloud workspace");
      expect(readFileSync(calls, "utf8")).toBe(
        `move --agent pi --session ${ID} --no-changes finish the tests --json\n`,
      );

      // A message typed here while the session is in the cloud is held back unless confirmed.
      send({ type: "prompt", message: "hello" });
      const typed = await next(ui("confirm"));
      expect(typed.title).toBe("This session is in the cloud");
      send({ type: "extension_ui_response", id: typed.id, confirmed: false });
      expect((await next(ui("set_editor_text"))).text).toBe("hello");

      send({ type: "prompt", message: "/cloud-return" });
      const end = await next(ui("select"));
      send({ type: "extension_ui_response", id: end.id, value: end.options![1] });
      const replace = await next(ui("confirm"));
      expect(replace.title).toBe("Replace what changed here since the move?");
      send({ type: "extension_ui_response", id: replace.id, confirmed: true });
      // The replacement session starts with no status.
      expect((await next(status)).statusText).toBeUndefined();
      expect(readFileSync(calls, "utf8").split("\n").slice(1, 3)).toEqual([
        `return ws-1 --session ${ID} --end delete --json`,
        `return ws-1 --session ${ID} --end delete --force --json`,
      ]);
    } finally {
      pi.kill("SIGTERM");
    }
  },
  60_000,
);
