/**
 * The terminal as a workspace runs it: Pi's base image, GitTerm's install and serve commands,
 * real ttyd and tmux. Needs Docker and a built page (`bun run build`). Run: `bun run test:session`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  TERMINAL_INSTALL_COMMAND,
  TERMINAL_PASSWORD_ENV,
  terminalServeCommand,
} from "@gitterm/schema/terminal";

const name = `gitterm-terminal-test-${process.pid}`;
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const sh = (command: string) => docker("exec", name, "bash", "-lc", command);
const agent = { name: "Test agent", command: "bash", keys: [{ label: "a=b's", send: "\u0018b" }] };
const auth = `Basic ${btoa("opencode:pw")}`;

try {
  docker(
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-e",
    `${TERMINAL_PASSWORD_ENV}=pw`,
    "-p",
    "127.0.0.1::7681",
    "node:24-bookworm",
    "sleep",
    "infinity",
  );
  sh("mkdir -p ~/.gitterm/terminal");
  for (const file of ["dist/index.html", "session.sh", "tmux.conf"]) {
    docker("cp", file, `${name}:/root/.gitterm/terminal/`);
  }
  sh(TERMINAL_INSTALL_COMMAND);
  docker("exec", "-d", name, "bash", "-lc", terminalServeCommand(7681, agent));
  const base = `127.0.0.1:${docker("port", name, "7681/tcp").split(":").at(-1)}`;
  for (let i = 0; (await fetch(`http://${base}/`).catch(() => undefined)) === undefined; i++) {
    if (i > 50) throw new Error("ttyd did not start");
    await Bun.sleep(200);
  }

  assert.equal((await fetch(`http://${base}/`)).status, 401, "the terminal needs the password");
  const page = await fetch(`http://${base}/`, { headers: { Authorization: auth } });
  assert.match(await page.text(), /<title>Terminal<\/title>/, "ttyd serves GitTerm's page");

  // As the page does: the token from /token goes in the first message.
  const { token } = await (
    await fetch(`http://${base}/token`, { headers: { Authorization: auth } })
  ).json();
  async function attach(query = "") {
    const socket = new WebSocket(`ws://${base}/ws${query}`, {
      protocols: ["tty"],
      headers: { Authorization: auth },
    } as unknown as string[]);
    socket.binaryType = "arraybuffer";
    let output = "";
    let prefs: Record<string, unknown> | undefined;
    socket.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      const text = new TextDecoder().decode(data.subarray(1));
      if (data[0] === 48) output += text;
      if (data[0] === 50) prefs = JSON.parse(text);
    };
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    socket.send(
      new TextEncoder().encode(JSON.stringify({ AuthToken: token, columns: 100, rows: 30 })),
    );
    const wait = async (pattern: RegExp) => {
      for (let i = 0; i < 100; i++) {
        const match = pattern.exec(output);
        if (match) return match;
        await Bun.sleep(100);
      }
      throw new Error(`Missing ${pattern} in ${JSON.stringify(output.slice(-500))}`);
    };
    return {
      socket,
      wait,
      prefs: () => prefs,
      send: (text: string) => socket.send(new TextEncoder().encode(`0${text}`)),
    };
  }

  // The page learns the agent from ttyd's -t option, `=` and quotes included.
  const first = await attach();
  await first.wait(/[$#] /);
  assert.deepEqual(first.prefs()?.gitterm, { name: agent.name, keys: agent.keys });

  // Every browser shares one tmux session: the same shell answers both.
  first.send("echo PID=$$\r");
  const pid = (await first.wait(/PID=(\d+)/))[1];
  const second = await attach();
  second.send("echo SECOND=$$\r");
  assert.equal((await second.wait(/SECOND=(\d+)/))[1], pid);

  // A copy inside tmux reaches the browser as OSC 52.
  first.send("printf '\\033]52;c;%s\\007' $(printf copied | base64)\r");
  await first.wait(/\]52;[a-z]*;Y29waWVk/);

  // Uploads land in ~/.gitterm/uploads, with a safe name, byte for byte, and two files with
  // the same name don't overwrite each other.
  async function send(bytes: Uint8Array) {
    const encoded = Buffer.from(bytes).toString("base64");
    const upload = await attach(
      `?arg=upload&arg=${encodeURIComponent("../my shot.png")}&arg=${encoded.length}`,
    );
    await upload.wait(/ready/);
    for (let at = 0; at < encoded.length; at += 32_768) {
      upload.send(encoded.slice(at, at + 32_768));
    }
    const path = (await upload.wait(/saved (\S+)\r?\n/))[1];
    upload.socket.close();
    assert.match(path, /^\/root\/\.gitterm\/uploads\/\w{8}\/\.\._my_shot\.png$/);
    return path;
  }
  const uploads = [
    crypto.getRandomValues(new Uint8Array(300_000)),
    crypto.getRandomValues(new Uint8Array(1000)),
  ];
  const paths = await Promise.all(uploads.map(send));
  assert.notEqual(paths[0], paths[1]);
  for (const [i, path] of paths.entries()) {
    assert.equal(
      sh(`sha256sum ${path} | cut -d' ' -f1`),
      createHash("sha256").update(uploads[i]).digest("hex"),
    );
  }
  // The upload didn't disturb the shared session.
  first.send("echo STILL=$$\r");
  assert.equal((await first.wait(/STILL=(\d+)/))[1], pid);

  for (const client of [first, second]) client.socket.close();
  console.log("Terminal session test passed");
} finally {
  try {
    docker("rm", "-f", name);
  } catch {}
}
