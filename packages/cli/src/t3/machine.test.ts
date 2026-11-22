import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sentSince } from "./flows.js";
import { remoteMachine } from "./machine.js";

/** A workspace that is this machine's shell, which, like some providers, throws on failure. */
function shell(limit = 120_000) {
  const commands: string[] = [];
  const exec = async (command: string) => {
    if (command.length > limit) throw new Error(`command of ${command.length} characters`);
    commands.push(command);
    const child = spawn("bash", ["-c", command]);
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const exitCode = await new Promise<number>((resolve) =>
      child.on("close", (code) => resolve(code ?? 1)),
    );
    if (exitCode !== 0) throw new Error(`exit ${exitCode}`);
    return { exitCode, stdout };
  };
  return { exec, commands };
}

test("files of any size go up and come back intact, in commands under the API limit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gitterm-t3-machine-"));
  try {
    const { exec, commands } = shell();
    const machine = remoteMachine(exec);
    for (const size of [0, 10, 200_000, 7 << 20]) {
      const data = randomBytes(size);
      const file = path.join(dir, `f${size}`);
      await machine.writeFile(file, data);
      expect((await readFile(file)).equals(data)).toBe(true);
      expect((await machine.readFile(file)).equals(data)).toBe(true);
    }
    expect(commands.length).toBeGreaterThan(10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing script reports its exit code instead of throwing", async () => {
  const machine = remoteMachine(shell().exec);
  const result = await machine.script(
    tmpdir(),
    "process.stdout.write(process.argv[1]); process.exit(3)",
    ["a b'c"],
  );
  expect(result).toEqual({ exit: 3, stdout: "a b'c" });
});

test("only real messages sent after the move count as local work", () => {
  const record = (value: unknown) => `${JSON.stringify(value)}\n`;
  const moved = record({ type: "user", message: { content: "move this" } });
  const finished =
    moved +
    record({ type: "user", message: { content: [{ type: "tool_result", content: "moved" }] } }) +
    record({ type: "assistant", message: { content: [{ type: "text", text: "Moved." }] } }) +
    record({ type: "user", isMeta: true, message: { content: "caveat" } });
  expect(sentSince(finished, moved.length)).toBe(false);
  expect(
    sentSince(finished + record({ type: "user", message: { content: "more" } }), moved.length),
  ).toBe(true);
});
