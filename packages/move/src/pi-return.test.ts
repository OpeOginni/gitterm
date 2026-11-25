import { afterAll, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "./checkout/snapshot.js";
import { CAPTURE_SCRIPT } from "./checkout/restore.js";
import { piAgent } from "./agents/pi.js";
import { moveToCloud, returnFromCloud, type Cloud } from "./flows.js";
import { localMachine, type Machine } from "./machine.js";
import { loadRecords } from "./records.js";

// Pi keeps real paths (macOS puts temp folders under /private).
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "gitterm-flows-")));
const home = process.env.HOME;
process.env.HOME = path.join(root, "home");
afterAll(() => {
  process.env.HOME = home;
  rmSync(root, { recursive: true, force: true });
});

const ID = "11111111-2222-4333-8444-555555555555";
const entry = (id: string, parentId: string | null, role: string, text: string) =>
  `${JSON.stringify({ type: "message", id, parentId, timestamp: "2026-11-23T10:00:00.000Z", message: { role, content: text, stopReason: "stop" } })}\n`;
const sessionFiles = (agentDir: string) =>
  readdirSync(path.join(agentDir, "sessions"), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(agentDir, "sessions", name));

test("a Pi session comes back only with its last turn, and the workspace stays until then", async () => {
  // A stand-in `pi` for `info`: the tests never run a real Pi.
  const fakePi = path.join(root, "pi");
  writeFileSync(fakePi, "#!/bin/sh\necho 1.6.0\n");
  chmodSync(fakePi, 0o755);

  const repo = path.join(root, "repo");
  mkdirSync(repo);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.name", "Test"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  writeFileSync(path.join(repo, "file.txt"), "initial\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-q", "-m", "initial"]);

  const hereAgent = path.join(root, "here");
  const sessions = path.join(hereAgent, "sessions", `--${repo.slice(1).replace(/[/\\:]/g, "-")}--`);
  mkdirSync(sessions, { recursive: true });
  const localFile = path.join(sessions, `2026-11-23T10-00-00-000Z_${ID}.jsonl`);
  writeFileSync(
    localFile,
    `${JSON.stringify({ type: "session", version: 3, id: ID, timestamp: "2026-11-23T10:00:00.000Z", cwd: repo })}\n${entry("a", null, "user", "Grüße 🚀 move this")}`,
  );

  // The workspace: a second Pi home and an empty directory on this machine. Notices are kept,
  // not delivered (in the cloud, notify starts Pi in tmux).
  const thereAgent = path.join(root, "there");
  const directory = path.join(root, "workspace");
  mkdirSync(directory);
  const notices: string[] = [];
  let beforeCapture = () => {};
  // Each read of the cloud session, after it is done.
  let afterCloudExport = (_count: number) => {};
  let cloudExports = 0;
  const holds: string[] = [];
  const machine = (agentDir: string): Machine => {
    const base = localMachine({
      PI_CODING_AGENT_DIR: agentDir,
      GITTERM_PI_BIN: fakePi,
      // hold stops this tmux session, never one of the user's.
      GITTERM_PI_TMUX: `gitterm-pi-test-${process.pid}`,
    });
    return {
      ...base,
      agent: async (script, op, input) => {
        if (op === "hold") holds.push(String(input?.ref));
        if (op !== "notify") {
          const result = await base.agent(script, op, input);
          if (op === "export" && agentDir === thereAgent) afterCloudExport(++cloudExports);
          return result as never;
        }
        notices.push(String(input?.message));
        return { started: false } as never;
      },
      script: (dir, script, args) => {
        if (script === CAPTURE_SCRIPT) beforeCapture();
        return base.script(dir, script, args);
      },
    };
  };
  const ended: string[] = [];
  const cloud: Cloud = {
    create: async () => "ws1",
    ready: async () => ({ url: "https://ws1.example", directory, canExec: true }),
    machine: () => machine(thereAgent),
    end: async (_id, how) => void ended.push(how),
    gone: async () => false,
  };
  const deps = { cloud, local: machine(hereAgent), agent: piAgent, progress: () => {} };

  await moveToCloud(deps, { ref: ID, changes: true, fromSession: false });
  const [record] = await loadRecords();
  const [cloudFile] = sessionFiles(thereAgent);
  expect(record?.workspaceId).toBe("ws1");

  // The cloud works on: a file and a turn.
  writeFileSync(path.join(directory, "cloud.txt"), "from the cloud\n");
  appendFileSync(cloudFile!, entry("b", "a", "user", "Create cloud.txt."));
  appendFileSync(cloudFile!, entry("c", "b", "assistant", "Created cloud.txt."));

  // While Pi works in the cloud session, nothing comes back.
  const busy = path.join(thereAgent, "gitterm", "busy", record!.cloudRef);
  mkdirSync(path.dirname(busy), { recursive: true });
  writeFileSync(busy, String(process.pid));
  expect(
    (await piAgent.session(deps.cloud.machine("ws1")).status({ ref: record!.cloudRef })).busy,
  ).toBe(true);
  await expect(returnFromCloud(deps, record!, { force: false, end: "delete" })).rejects.toThrow(
    "Pi is still working",
  );
  rmSync(busy);

  // A turn that lands after the conversation was read: the return stops before changing
  // anything here, and the workspace stays.
  beforeCapture = () => {
    beforeCapture = () => {};
    appendFileSync(cloudFile!, entry("d", "c", "user", "One more thing."));
  };
  await expect(returnFromCloud(deps, record!, { force: false, end: "delete" })).rejects.toThrow(
    "went on while it was being copied",
  );
  expect(ended).toEqual([]);
  expect(existsSync(path.join(repo, "cloud.txt"))).toBe(false);
  expect(readFileSync(localFile, "utf8")).not.toContain("Create cloud.txt.");

  // A turn that lands after the last read, while the conversation is brought back: everything
  // up to it comes back, and the workspace, which has the turn, is kept.
  cloudExports = 0;
  afterCloudExport = (count) => {
    if (count === 2) appendFileSync(cloudFile!, entry("e", "d", "user", "A late turn."));
  };
  const result = await returnFromCloud(deps, record!, { force: false, end: "delete" });
  expect(readFileSync(path.join(repo, "cloud.txt"), "utf8")).toBe("from the cloud\n");
  expect(readFileSync(localFile, "utf8")).toContain("One more thing.");
  expect(readFileSync(localFile, "utf8")).not.toContain("A late turn.");
  expect(readFileSync(cloudFile!, "utf8")).toContain("A late turn.");
  expect(ended).toEqual([]);
  expect(result.warnings).toEqual([expect.stringContaining("workspace ws1 was kept running")]);
  // Every return stopped the workspace's Pi before reading.
  expect(holds).toEqual([record!.cloudRef, record!.cloudRef, record!.cloudRef]);
  expect(notices).toHaveLength(2);
}, 60_000);
