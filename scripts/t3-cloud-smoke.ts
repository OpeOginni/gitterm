/**
 * Moves real T3 Code threads to a "cloud" and back, with two local T3 servers: one stands
 * for this machine, the other for a GitTerm workspace reached through the same chunked
 * command transport `workspace.execCommand` gives. Uses Claude Code (Haiku) with your login.
 *
 *   bun scripts/t3-cloud-smoke.ts          (KEEP=1 keeps the scratch directory)
 *
 * 1. Moves an idle thread, uses it in the cloud, and brings it back into the same thread.
 * 2. Has a thread's own agent run the move mid-turn, as the gitterm-cloud skill does.
 *
 * T3_SMOKE_BINARY overrides the t3 command (default ~/.t3/bin/t3).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

type Config = {
  root: string;
  realHome: string;
  t3bin: string;
  localBase: string;
  cloudBase: string;
  cloudUrl: string;
};

const run = promisify(execFile);

async function standIn(config: Config, cloudDir: string) {
  // Move records go to a scratch HOME; T3 servers and Claude keep the real one (and its login).
  process.env.HOME = join(config.root, "home");
  process.env.T3CODE_CLI_PATH = config.t3bin;
  process.env.T3CODE_HOME = config.localBase;
  const { localMachine, remoteMachine } = await import("../packages/cli/src/move/machine");
  const local = localMachine({ HOME: config.realHome, T3CODE_HOME: config.localBase });
  const cloudEnv = { ...process.env, HOME: config.realHome, T3CODE_HOME: config.cloudBase };
  const stats = { commands: 0, ended: [] as string[] };
  const cloudMachine = remoteMachine(async (command) => {
    stats.commands++;
    // Like the API: one shell command, its output, never a thrown exit code.
    const child = spawn("bash", ["-c", command], { cwd: config.root, env: cloudEnv });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const exitCode = await new Promise<number>((resolve) =>
      child.on("close", (code) => resolve(code ?? 1)),
    );
    return { exitCode, stdout };
  });
  const cloud = {
    create: async (input: { agent: string }) => {
      if (input.agent !== "t3code") throw new Error(`asked for a ${input.agent} workspace`);
      return `ws-${cloudDir.split("/").at(-1)}`;
    },
    ready: async () => ({ url: config.cloudUrl, directory: cloudDir, canExec: true }),
    machine: () => cloudMachine,
    end: async (_id: string, how: string) => void stats.ended.push(how),
  };
  return { local, cloud, cloudMachine, stats };
}

// What the gitterm-cloud skill has the agent run, with the stand-in cloud: `agent-move <config>`.
if (process.argv[2] === "agent-move") {
  const config = JSON.parse(readFileSync(process.argv[3]!, "utf8")) as Config;
  const cloudDir = join(config.root, "cloud", "agent");
  mkdirSync(cloudDir, { recursive: true });
  const { local, cloud } = await standIn(config, cloudDir);
  const { moveToCloud } = await import("../packages/cli/src/move/flows");
  const { currentSession } = await import("../packages/cli/src/move/agents/index");
  // As `gitterm move` does: the agent and session come from the agent's own environment.
  const current = currentSession()!;
  const moved = await moveToCloud(
    { cloud, local, agent: current.agent, progress: () => {} },
    { ref: current.ref, changes: true, fromSession: true },
  );
  writeFileSync(
    join(config.root, "agent-move.json"),
    JSON.stringify({ ...moved, localThreadId: current.ref }),
  );
  console.log(`Moved. Cloud thread: ${moved.links["Cloud thread"]}`);
  process.exit(0);
}

const realHome = homedir();
const t3bin = process.env.T3_SMOKE_BINARY ?? join(realHome, ".t3", "bin", "t3");
const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(realHome, ".claude");
const root = realpathSync(mkdtempSync(join(tmpdir(), "gitterm-t3-cloud-")));
const realEnv = { ...process.env, HOME: realHome };
const servers: ChildProcess[] = [];
const check = (ok: unknown, message: string) => {
  if (!ok) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
};

async function startServer(name: string, port: number, cwd: string) {
  const base = join(root, name);
  mkdirSync(join(base, "userdata"), { recursive: true });
  writeFileSync(
    join(base, "userdata", "settings.json"),
    JSON.stringify({ linkedEnvironmentsEnabled: true }),
  );
  const child = spawn(
    t3bin,
    ["serve", "--base-dir", base, "--port", String(port), "--no-browser", cwd],
    {
      cwd,
      env: realEnv,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  servers.push(child);
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return base;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} T3 server did not start`);
}

const t3 = (base: string, ...args: string[]) =>
  run(t3bin, [...args, "--base-dir", base], {
    cwd: root,
    env: realEnv,
    maxBuffer: 64 << 20,
    timeout: 600_000,
  }).then((r) => r.stdout);
const ask = async (base: string, threadId: string, message: string) =>
  JSON.parse(await t3(base, "thread", "send", threadId, message, "--wait", "--json"))
    .reply as string;
const start = async (base: string, repo: string, message: string) =>
  JSON.parse(
    await t3(
      base,
      "thread",
      "start",
      repo,
      message,
      "--provider",
      "claudeAgent",
      "--model",
      "claude-haiku-4-5",
      "--wait",
      "--json",
    ),
  ) as { threadId: string; status: string; reply: string };
const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd }).then((r) =>
    r.stdout.trim(),
  );
async function idle(machine: import("../packages/cli/src/move/machine").Machine, threadId: string) {
  const { t3Agent } = await import("../packages/cli/src/move/agents/t3");
  for (let i = 0; i < 150; i++) {
    if (
      !(await machine.agent<{ busy: boolean }>(t3Agent.script!, "status", { ref: threadId })).busy
    )
      return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${threadId} stayed busy`);
}

try {
  const repo = join(root, "local", "repo");
  mkdirSync(repo, { recursive: true });
  await git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# smoke\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-qm", "init");
  const cloudDir = join(root, "cloud", "repo");
  mkdirSync(cloudDir, { recursive: true });

  const config: Config = {
    root,
    realHome,
    t3bin,
    localBase: await startServer("local-t3", 47911, repo),
    cloudBase: await startServer("cloud-t3", 47912, cloudDir),
    cloudUrl: "http://127.0.0.1:47912",
  };
  const { local, cloud, cloudMachine, stats } = await standIn(config, cloudDir);
  const { moveToCloud, returnFromCloud } = await import("../packages/cli/src/move/flows");
  const { loadRecords } = await import("../packages/cli/src/move/records");
  const { t3Agent: agent, pairEnvironment } = await import("../packages/cli/src/move/agents/t3");
  const progress = (message: string) => console.log(`  … ${message}`);

  console.log("# 1. Move an idle thread, work in the cloud, bring it back");
  await t3(config.localBase, "project", "add", repo);
  const started = await start(
    config.localBase,
    repo,
    "This is a test of moving our conversation between machines. The test word is MANGO-31; I'll ask for it later. Please create notes.txt containing 'local work' (don't commit it), then reply OK.",
  );
  check(started.status === "completed", "local thread ran");
  check(existsSync(join(repo, "notes.txt")), "local thread left an uncommitted file");

  const moved = await moveToCloud(
    { cloud, local, agent, progress },
    {
      ref: started.threadId,
      changes: true,
      fromSession: false,
      message: "Reply with just: ready",
    },
  );
  console.log("  moved:", JSON.stringify(moved));
  check(moved.ref.startsWith("import:claudeAgent:"), "cloud imported the session as a thread");
  check(
    moved.links["Cloud thread"]?.startsWith("t3-thread://v2/"),
    "a link opens the cloud thread",
  );
  check(
    readFileSync(join(cloudDir, "notes.txt"), "utf8").includes("local work"),
    "uncommitted change reached the cloud checkout",
  );
  check(moved.warnings.length === 0, `no warnings (${moved.warnings.join("; ")})`);
  const links = JSON.parse(await t3(config.localBase, "environment", "list", "--json")) as Array<{
    urls: string[];
  }>;
  check(
    links.some((link) => link.urls.some((url) => url.startsWith(config.cloudUrl))),
    "cloud environment is linked here",
  );
  console.log(`  ${stats.commands} workspace commands for the move`);

  await idle(cloudMachine, moved.ref);
  const word = await ask(
    config.cloudBase,
    moved.ref,
    "From our conversation (not from files): what was the test word? Reply with just the word.",
  );
  check(word.includes("MANGO-31"), `cloud thread remembers the conversation (${word})`);
  const cwd = await ask(
    config.cloudBase,
    moved.ref,
    "Create cloud.txt containing 'cloud work', commit everything with message 'cloud', then run pwd and reply with only its output.",
  );
  check(cwd.includes(cloudDir), `cloud agent works in the cloud checkout (${cwd})`);

  const [record] = await loadRecords();
  check(record?.workspaceId === "ws-repo", "move recorded");
  const back = await returnFromCloud({ cloud, local, agent, progress }, record!, {
    force: false,
    end: "pause",
    message: "Reply with just: back",
  });
  console.log("  returned:", JSON.stringify(back));
  check(
    readFileSync(join(repo, "cloud.txt"), "utf8").includes("cloud work"),
    "cloud's file came back",
  );
  check((await git(repo, "log", "-1", "--format=%s")) === "cloud", "cloud's commit came back");
  check(stats.ended.includes("pause"), "workspace paused after return");
  await idle(local, started.threadId);
  const memory = await ask(
    config.localBase,
    started.threadId,
    "From our conversation (not from files): which file did you create in the cloud workspace, and what was the test word? One line.",
  );
  check(
    /cloud\.txt/.test(memory) && /MANGO-31/.test(memory),
    `same local thread continues with the cloud's history (${memory})`,
  );

  console.log("# 2. The thread's own agent moves it, mid-turn");
  const configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify(config));
  const self = await start(
    config.localBase,
    repo,
    `This tests moving our conversation to another machine. The test word is PEAR-12; I'll ask for it on the other machine. Run this one command now: bun ${join(import.meta.dir, "t3-cloud-smoke.ts")} agent-move ${configFile}\nThen tell me its output.`,
  );
  check(
    self.status === "completed",
    `local turn that ran the move finished (${self.reply?.slice(0, 120)})`,
  );
  const agentMove = JSON.parse(readFileSync(join(root, "agent-move.json"), "utf8")) as {
    localThreadId: string;
    ref: string;
  };
  check(
    agentMove.localThreadId === self.threadId,
    "the move used the thread's own id from T3CODE_THREAD_ID",
  );
  const cloudThreadId = agentMove.ref;
  await idle(cloudMachine, cloudThreadId);
  const pear = await ask(
    config.cloudBase,
    cloudThreadId,
    "From our conversation (not from files): what was the test word? Reply with just the word.",
  );
  check(pear.includes("PEAR-12"), `cloud thread resumed from a mid-turn copy (${pear})`);

  console.log("# 3. A linked cloud environment for delegate_task");
  const envDir = join(root, "cloud", "env");
  mkdirSync(envDir, { recursive: true });
  await git(envDir, "init", "-q");
  // As `gitterm t3 link` does: a workspace, paired and linked to the local T3 Code.
  const envCloud = (await standIn(config, envDir)).cloud;
  const envReady = await envCloud.ready();
  const environment = await pairEnvironment(envCloud.machine(), {
    url: envReady.url,
    cwd: envReady.directory,
    access: "full-access",
  });
  console.log("  environment:", JSON.stringify(environment));
  const delegated = await start(
    config.localBase,
    repo,
    `Use the delegate_task tool (load it with ToolSearch first if needed) with target.environmentId "${environment.environmentId}", target.projectId "${environment.projectId}", provider claudeAgent, model claude-haiku-4-5, mode wait, and the task 'Run pwd and reply with only its output.' Then reply with exactly the delegated result.`,
  );
  check(
    delegated.reply?.includes(envDir),
    `delegated task ran in the linked workspace (${delegated.reply})`,
  );
  console.log("PASS");
} finally {
  for (const server of servers) server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  if (!process.env.KEEP) {
    rmSync(root, { recursive: true, force: true });
    // Claude Code keeps sessions per directory; drop the ones for this run's checkouts.
    const prefix = root.replace(/[^a-zA-Z0-9]/g, "-");
    for (const dir of ["local-repo", "cloud-repo", "cloud-agent", "cloud-env"])
      rmSync(join(claudeHome, "projects", `${prefix}-${dir}`), { recursive: true, force: true });
  } else console.log(`kept ${root}`);
}
