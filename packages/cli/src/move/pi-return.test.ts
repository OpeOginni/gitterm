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
import { git } from "../../../opencode-cloud/src/snapshot.js";
import { CAPTURE_SCRIPT } from "../../../opencode-cloud/src/restore.js";
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
  const machine = (agentDir: string): Machine => {
    const base = localMachine({ PI_CODING_AGENT_DIR: agentDir, GITTERM_PI_BIN: fakePi });
    return {
      ...base,
      agent: async (script, op, input) => {
        if (op !== "notify") return base.agent(script, op, input);
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
    ready: async () => ({ url: "https://ws1.example", directory }),
    machine: () => machine(thereAgent),
    end: async (_id, how) => void ended.push(how),
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
    (
      await deps.cloud.machine("ws1").agent<{ busy: boolean }>(piAgent.script, "status", {
        ref: record!.cloudRef,
      })
    ).busy,
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

  // Once the cloud is done, everything comes back and the workspace goes.
  await returnFromCloud(deps, record!, { force: false, end: "delete" });
  expect(readFileSync(path.join(repo, "cloud.txt"), "utf8")).toBe("from the cloud\n");
  expect(readFileSync(localFile, "utf8")).toContain("One more thing.");
  expect(ended).toEqual(["delete"]);
  expect(notices).toHaveLength(2);
}, 60_000);
