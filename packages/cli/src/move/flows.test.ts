import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "../../../opencode-cloud/src/snapshot.js";
import type { AgentAdapter } from "./agents/types.js";
import { moveToCloud, returnFromCloud, type Cloud } from "./flows.js";
import { localMachine } from "./machine.js";
import { loadRecords } from "./records.js";
import { agentScript } from "./script.js";

/** An agent whose sessions are JSON files of messages under FAKE_AGENT_HOME. */
const fakeAgent: AgentAdapter = {
  key: "fake",
  label: "Fake",
  script: agentScript(String.raw`
const file = (ref) => path.join(process.env.FAKE_AGENT_HOME, ref + ".json");
const read = (ref) => JSON.parse(fs.readFileSync(file(ref), "utf8"));
const write = (ref, session) => { fs.mkdirSync(path.dirname(file(ref)), { recursive: true }); fs.writeFileSync(file(ref), JSON.stringify(session)); };
const ops = {
  async info() { return { version: "1" }; },
  async export() { const s = read(input.ref); return { ref: input.ref, cwd: s.cwd, title: "test", mark: s.messages.length, payload: { messages: s.messages } }; },
  async import() { const ref = input.ref || crypto.randomUUID(); write(ref, { cwd: input.cwd, messages: input.payload.messages }); return { ref }; },
  async notify() { const s = read(input.ref); s.messages.push(input.message); write(input.ref, s); return {}; },
  async status() { return { busy: false }; },
};
`),
  currentSession: () => undefined,
  sentSince: (session, mark) => (session.payload.messages as string[]).length > mark,
};

let temporary: string;
const realHome = process.env.HOME;
beforeEach(async () => {
  temporary = await realpath(await mkdtemp(path.join(tmpdir(), "gitterm-flows-")));
  process.env.HOME = path.join(temporary, "home");
});
afterEach(async () => {
  process.env.HOME = realHome;
  await rm(temporary, { recursive: true, force: true });
});

test("a return whose workspace cannot be ended is still done, and says so", async () => {
  const source = path.join(temporary, "source");
  const cloudDirectory = path.join(temporary, "cloud");
  await mkdir(source);
  await mkdir(cloudDirectory);
  await git(source, ["init", "-q", "-b", "main"]);
  await writeFile(path.join(source, "hello.txt"), "initial\n");
  await git(source, ["add", "."]);
  await git(source, [
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-qm",
    "init",
  ]);
  const localHome = path.join(temporary, "agent-local");
  await mkdir(localHome);
  await writeFile(
    path.join(localHome, "s1.json"),
    JSON.stringify({ cwd: source, messages: ["hello"] }),
  );

  const local = localMachine({ FAKE_AGENT_HOME: localHome });
  const remote = localMachine({ FAKE_AGENT_HOME: path.join(temporary, "agent-cloud") });
  let ending: Error | undefined;
  const cloud: Cloud = {
    create: async () => "ws-1",
    ready: async () => ({ url: "http://workspace", directory: cloudDirectory }),
    machine: () => remote,
    end: async () => {
      if (ending) throw ending;
    },
  };
  const deps = { cloud, local, agent: fakeAgent, progress: () => {} };
  await moveToCloud(deps, { ref: "s1", changes: true, fromSession: false });

  // Work in the cloud, then a return whose last step fails.
  await writeFile(path.join(cloudDirectory, "hello.txt"), "from the cloud\n");
  ending = new Error("API down");
  const [record] = await loadRecords();
  const result = await returnFromCloud(deps, record!, { force: false, end: "delete" });

  expect(result.warnings).toEqual([
    "Could not delete workspace ws-1 (run gitterm ws terminate ws-1): API down",
  ]);
  expect(await readFile(path.join(source, "hello.txt"), "utf8")).toBe("from the cloud\n");
  const session = JSON.parse(await readFile(path.join(localHome, "s1.json"), "utf8"));
  expect(session.messages[0]).toBe("hello");
  expect(session.messages.at(-1)).toContain("This session is back");
  expect((await loadRecords())[0]!.returnedAt).toBeDefined();
});
