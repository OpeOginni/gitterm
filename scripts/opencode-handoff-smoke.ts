/** Opt-in OpenCode compatibility smoke. Isolated homes, loopback only, no cloud/model calls. */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handoffSession, runtimeClient } from "../packages/opencode-plugin/src/handoff";
import { git } from "../packages/opencode-plugin/src/snapshot";

const binary = process.env.OPENCODE_HANDOFF_SMOKE_BINARY;
if (!binary)
  throw new Error("Set OPENCODE_HANDOFF_SMOKE_BINARY to a locally installed OpenCode executable");
if (process.platform === "win32")
  throw new Error("This isolated process-group smoke requires macOS or Linux");
const executable = resolve(binary);
const root = await mkdtemp(
  join(process.env.OPENCODE_HANDOFF_SMOKE_ROOT ?? tmpdir(), "gitterm-opencode-smoke-"),
);
const source = join(root, "source");
const cloud = join(root, "cloud");
const servers: ChildProcess[] = [];
const password = "isolated-smoke-password";
const signal = AbortSignal.timeout(120_000);

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function start(name: string, directory: string) {
  const home = join(root, `${name}-home`);
  await mkdir(home);
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: directory,
    detached: true,
    stdio: "ignore",
    env: {
      PATH: `${dirname(executable)}:${process.env.PATH}`,
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      LANG: "en_US.UTF-8",
      SHELL: "/bin/sh",
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_CACHE_HOME: join(home, "cache"),
      OPENCODE_SERVER_PASSWORD: password,
    },
  });
  servers.push(child);
  const client = runtimeClient({ url, password, directory } as Parameters<typeof runtimeClient>[0]);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await client.server.info({ signal: AbortSignal.timeout(1_000) });
      return { url, client };
    } catch {}
    if (child.exitCode !== null) throw new Error(`${name} server exited before readiness`);
    await Bun.sleep(200);
  }
  throw new Error(`${name} server readiness timed out`);
}

try {
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await git(source, ["config", "user.name", "Smoke"]);
  await git(source, ["config", "user.email", "smoke@example.com"]);
  await writeFile(join(source, "file.txt"), "initial\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "initial"]);
  await git(root, ["clone", source, cloud]);
  await git(source, ["remote", "add", "origin", "https://github.com/example/fixture.git"]);
  const plugin = fileURLToPath(new URL("../packages/opencode-plugin/dist", import.meta.url));
  await writeFile(join(source, ".git/info/exclude"), "opencode.json\n");
  await writeFile(
    join(source, "opencode.json"),
    JSON.stringify({ plugins: [{ package: plugin }] }),
  );
  await writeFile(join(source, "unpublished.txt"), "local commit\n");
  await git(source, ["add", "unpublished.txt"]);
  await git(source, ["commit", "-m", "local-only commit"]);
  const local = await start("local", source);
  const remote = await start("cloud", cloud);
  const session = await local.client.session.create(
    { location: { directory: source }, title: "Handoff smoke" },
    { signal },
  );
  let commands = await local.client.command.list({ location: { directory: source } }, { signal });
  const activationDeadline = Date.now() + 15_000;
  while (
    !commands.data.some((command) => command.name === "cloud") &&
    Date.now() < activationDeadline
  ) {
    await Bun.sleep(200);
    commands = await local.client.command.list({ location: { directory: source } }, { signal });
  }
  if (!commands.data.some((command) => command.name === "cloud")) {
    console.log(await local.client.plugin.list({ location: { directory: source } }, { signal }));
    throw new Error("OpenCode plugin command did not load");
  }
  await local.client.session.shell(
    { sessionID: session.id, command: "printf 'local smoke history\\n'" },
    { signal },
  );
  // Shell completion queues a synthetic notification; clear it without invoking a model.
  for (const pending of await local.client.session.inbox.list(
    { sessionID: session.id },
    { signal },
  )) {
    await local.client.session.inbox.cancel(
      { sessionID: session.id, inboxID: pending.id },
      { signal },
    );
  }
  await writeFile(join(source, "file.txt"), "staged smoke\n");
  await git(source, ["add", "file.txt"]);
  await writeFile(join(source, "file.txt"), "unstaged smoke\n");
  await writeFile(join(source, "new.bin"), Buffer.from([0, 255, 1]));

  const formPolling = new AbortController();
  const answerForms = async () => {
    const answered = new Set<string>();
    while (!formPolling.signal.aborted) {
      for (const form of await local.client.session.form.list(
        { sessionID: session.id },
        { signal },
      )) {
        if (answered.has(form.id)) continue;
        answered.add(form.id);
        await local.client.session.form.reply(
          {
            sessionID: session.id,
            formID: form.id,
            answer: form.fields[0]?.key === "changes" ? { changes: true } : { create: true },
          },
          { signal },
        );
      }
      await Bun.sleep(100);
    }
  };
  const answering = answerForms();
  try {
    const record = await handoffSession(session.id, {
      local: local.client,
      gitterm: {
        workspaces: {
          create: async () => ({ workspace: { id: "isolated-cloud" } }),
          ensureRunning: async () => {},
          getRuntimeAccess: async () => ({
            url: remote.url,
            password,
            directory: await realpath(cloud),
          }),
        },
      } as unknown as Parameters<typeof handoffSession>[1]["gitterm"],
      options: {},
      signal,
      save: async () => {},
      progress: async (text) => console.log(text),
    });
    check(record.phase === "ready", "Handoff did not reach ready");
  } finally {
    formPolling.abort();
    await answering;
  }

  check(
    (await readFile(join(cloud, "file.txt"), "utf8")) === "unstaged smoke\n",
    "Dirty file not transferred",
  );
  check(
    (await readFile(join(cloud, "new.bin"))).equals(Buffer.from([0, 255, 1])),
    "Binary untracked file not transferred",
  );
  check(
    (await git(source, ["diff", "--cached"])).equals(await git(cloud, ["diff", "--cached"])),
    "Staging state differs",
  );
  const imported = await remote.client.session.export({ sessionID: session.id }, { signal });
  check(
    imported.messages.some((message) => message.type === "shell"),
    "Conversation history was not imported",
  );
  check(
    Object.keys(await remote.client.session.active({ signal })).length === 0,
    "Import unexpectedly started model execution",
  );
  check(
    (await readFile(join(source, "file.txt"), "utf8")) === "unstaged smoke\n",
    "Local file changed",
  );
  console.log(
    "OpenCode handoff smoke passed: real forms, binary HTTP upload, restore verification, staging state, unpublished commits, session history; no model or cloud calls.",
  );
} finally {
  for (const server of servers) {
    if (server.exitCode !== null || server.signalCode !== null) continue;
    const exited = once(server, "exit");
    process.kill(-server.pid!, "SIGKILL");
    await exited;
  }
  await rm(root, { recursive: true, force: true });
}
