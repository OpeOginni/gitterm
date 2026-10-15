import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { chromium } from "@playwright/test";

const name = `gitterm-terminal-test-${process.pid}`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
let browser;
try {
  docker("run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::7681", "gitterm-terminal:test");
  const port = docker("port", name, "7681/tcp").split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /GitTerm/);

  async function attach() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["tty"]);
    let output = "";
    const waiters = [];
    socket.on("message", (data) => {
      if (data[0] === 48) output += data.subarray(1).toString();
      for (const notify of waiters) notify();
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(Buffer.from(JSON.stringify({ AuthToken: "", columns: 90, rows: 30 })));
    return {
      socket,
      send: (text) => socket.send(Buffer.from("0" + text)),
      wait: (text) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Missing ${text}: ${output}`)), 10_000);
          const check = () => {
            if (output.includes(text)) {
              clearTimeout(timeout);
              resolve();
            }
          };
          waiters.push(check);
          check();
        }),
      close: () =>
        new Promise((resolve) => {
          socket.once("close", resolve);
          socket.close();
        }),
    };
  }
  const first = await attach();
  await first.wait("#");
  first.send("export GT_RECONNECT_TEST=kept; printf 'FIRST_%s\\n' ready\r");
  await first.wait("FIRST_ready");
  const pid = docker("exec", name, "tmux", "-L", "gitterm", "display-message", "-p", "#{pane_pid}");
  await first.close();
  const second = await attach();
  await second.wait("#");
  second.send("printf 'SECOND_%s\\n' \"$GT_RECONNECT_TEST\"\r");
  await second.wait("SECOND_kept");
  assert.equal(
    docker("exec", name, "tmux", "-L", "gitterm", "display-message", "-p", "#{pane_pid}"),
    pid,
  );
  await second.close();

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(base);
  await page.locator('[data-connection="connected"]').waitFor();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await page.locator("#draft").fill("A draft above the keyboard");
  await page.screenshot({ path: "test-results/mobile-terminal.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/desktop-terminal.png" });
  console.log(
    "Real ttyd/tmux: same shell PID and environment survived WebSocket disconnect; browser connected.",
  );
} finally {
  await browser?.close();
  docker("rm", "-f", name);
}
