import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFile } from "../compute";

test("E2B writes home-relative agent config/auth to HOME, not a literal tilde directory", async () => {
  const { E2BProvider } = await import(".");
  const directory = mkdtempSync(join(tmpdir(), "gitterm-e2b-agent-files-"));
  try {
    const home = join(directory, "user's home");
    const cwd = join(directory, "command-cwd");
    const repo = join(directory, "user's repo");
    for (const path of [home, cwd, repo]) mkdirSync(path);
    const files: AgentFile[] = [
      {
        path: "~/.config/opencode/opencode.json",
        contentBase64: Buffer.from('{"permission":{"bash":"ask"}}').toString("base64"),
        mode: 0o600,
      },
      {
        path: "~/.local/share/opencode/auth.json",
        contentBase64: Buffer.from('{"opencode":{"type":"api","key":"public"}}').toString("base64"),
        mode: 0o600,
      },
      {
        path: "secrets/it's $(not-a-command).bin",
        relativeToRepo: true,
        contentBase64: Buffer.from([0, 255, 10, 128]).toString("base64"),
        mode: 0o400,
      },
      {
        path: join(directory, "absolute file"),
        contentBase64: Buffer.from("absolute").toString("base64"),
      },
      {
        path: "~/home-file",
        contentBase64: Buffer.from("directly below HOME").toString("base64"),
      },
      {
        path: "~/literal-repo-file",
        relativeToRepo: true,
        contentBase64: Buffer.from("repo-relative tilde stays literal").toString("base64"),
      },
    ];
    const sandbox = {
      commands: {
        async run(command: string) {
          const result = Bun.spawnSync(["bash", "-c", command], {
            cwd,
            env: { ...process.env, HOME: home },
          });
          if (result.exitCode !== 0) throw new Error(result.stderr.toString());
        },
      },
      async kill() {},
    };
    await (new E2BProvider() as any).writeAgentFiles(sandbox, { agent: { files } }, repo);
    for (const file of files) {
      const target = file.relativeToRepo
        ? join(repo, file.path)
        : file.path.replace(/^~\//, `${home}/`);
      expect(readFileSync(target)).toEqual(Buffer.from(file.contentBase64, "base64"));
      if (file.mode) expect(statSync(target).mode & 0o777).toBe(file.mode);
    }
    expect(existsSync(join(cwd, "~"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("E2B provisions runtime-only agent files as root and returns ownership to the agent", async () => {
  const { E2BProvider } = await import(".");
  const commands: Array<{ command: string; options?: { user?: string } }> = [];
  const sandbox = {
    commands: {
      async run(command: string, options?: { user?: string }) {
        commands.push({ command, options });
      },
    },
    async kill() {},
  };
  const files: AgentFile[] = [
    {
      path: "/run/gitterm/github/credential.json",
      contentBase64: Buffer.from('{"token":"secret"}').toString("base64"),
      mode: 0o600,
    },
  ];

  await (new E2BProvider() as any).writeAgentFiles(sandbox, { agent: { files } }, "/repo");

  expect(commands).toHaveLength(2);
  expect(commands.every(({ options }) => options?.user === "root")).toBe(true);
  expect(commands[0]!.command).toContain("mkdir -p '/run/gitterm/github'");
  expect(commands[0]!.command).toContain("chown user:user '/run/gitterm/github'");
  expect(commands[0]!.command).toContain("chmod 700 '/run/gitterm/github'");
  expect(commands[1]!.command).toContain("chown user:user '/run/gitterm/github/credential.json'");
  expect(commands[1]!.command).toContain("chmod 600 '/run/gitterm/github/credential.json'");
});
