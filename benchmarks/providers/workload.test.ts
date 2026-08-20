import { expect, test } from "bun:test";
import { buildWorkspaceBenchmarkCommand, parseWorkspaceBenchmarkLog } from "./workload";

test("workspace benchmark command emits a parseable result", async () => {
  const command = buildWorkspaceBenchmarkCommand({ cpuIterations: 100_000, diskSizeMiB: 4 });
  const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const result = parseWorkspaceBenchmarkLog(stdout);
  expect(result.cpu.iterations).toBe(100_000);
  expect(result.cpu.millionIterationsPerSecond).toBeGreaterThan(0);
  expect(result.disk.sizeMiB).toBe(4);
  expect(result.disk.writeMiBPerSecond).toBeGreaterThan(0);
  expect(result.disk.readMiBPerSecond).toBeGreaterThan(0);
  expect(result.runtime.logicalCpus).toBeGreaterThan(0);
});
