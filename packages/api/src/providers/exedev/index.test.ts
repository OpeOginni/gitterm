import { expect, test } from "bun:test";
import { ExeDevProvider } from ".";

const handle = JSON.stringify({
  vmName: "test",
  repoDir: "/home/exedev/repo",
  serve: { command: "t3 start", port: 4096 },
});

test("exe.dev reports the remote command status, not just its HTTP success", async () => {
  const provider = new ExeDevProvider();
  const internals = provider as unknown as {
    runVmCommand: (handle: unknown, command: string) => Promise<unknown>;
  };
  internals.runVmCommand = async (_handle, command) => {
    expect(command).toContain("cd '/home/exedev/repo'");
    expect(command).toContain("(mint-token)");
    return "pairing-token\n__GITTERM_COMMAND_EXIT__0\n";
  };
  expect(await provider.execCommand(handle, "mint-token")).toEqual({
    exitCode: 0,
    stdout: "pairing-token",
  });
  internals.runVmCommand = async () => "\n__GITTERM_COMMAND_EXIT__7\n";
  expect(await provider.execCommand(handle, "mint-token")).toEqual({ exitCode: 7, stdout: "" });
  internals.runVmCommand = async () => "incomplete response";
  expect(await provider.execCommand(handle, "mint-token")).toEqual({ exitCode: 1, stdout: "" });
});
