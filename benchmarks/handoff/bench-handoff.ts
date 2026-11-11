#!/usr/bin/env bun
/**
 * Measures the checkout half of `/cloud` (packages/opencode-cloud): what `captureSnapshot`
 * uploads, how long capture and restore take, and which checkouts survive the round trip.
 * Everything runs in temporary directories with the real capture code and restore script;
 * no workspace is created and nothing is uploaded.
 *
 *   bun benchmarks/handoff/bench-handoff.ts [--only repo,scale,matrix] [--repo <path>]
 *
 * "Cloud" here is a fresh clone of the origin, which is what a new workspace starts from.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PREPARE_STAGE_SCRIPT, RESTORE_SCRIPT } from "../../packages/opencode-cloud/src/restore";
import {
  captureSnapshot,
  encodeSnapshot,
  type CheckoutSnapshot,
} from "../../packages/opencode-cloud/src/snapshot";

const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1]!;
};
const only = flag("only", "repo,scale,matrix").split(",");
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "Usage: bun benchmarks/handoff/bench-handoff.ts [--only repo,scale,matrix] [--repo <path>]\nRuns locally; no cloud or model calls. See benchmarks/handoff/README.md.",
  );
  process.exit(0);
}
for (const section of only) {
  if (!["repo", "scale", "matrix"].includes(section))
    throw new Error(`Unknown section: ${section}`);
}
const temporary = mkdtempSync(path.join(tmpdir(), "gitterm-handoff-bench-"));
const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Bench",
      GIT_AUTHOR_EMAIL: "bench@example.com",
      GIT_COMMITTER_NAME: "Bench",
      GIT_COMMITTER_EMAIL: "bench@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  })
    .toString()
    .trim();

const write = (root: string, file: string, data: string | Uint8Array) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), data);
};
const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(Math.min(bytes, 65536)));
/** Incompressible content, so sizes on disk are what travels. */
function blob(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let offset = 0; offset < bytes; offset += 65536) out.set(random(bytes - offset), offset);
  return out;
}

type Capture = {
  ms: number;
  snapshot?: CheckoutSnapshot;
  payload: number;
  peakRssMb: number;
  error?: string;
};

async function capture(
  directory: string,
  includeChanges: boolean,
  fullHistory = false,
): Promise<Capture> {
  let peak = process.memoryUsage().rss;
  const base = peak;
  const sampler = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 2);
  const started = performance.now();
  try {
    const snapshot = await captureSnapshot(directory, includeChanges, fullHistory);
    const payload = encodeSnapshot(snapshot).length;
    peak = Math.max(peak, process.memoryUsage().rss);
    return {
      ms: performance.now() - started,
      snapshot,
      payload,
      peakRssMb: (peak - base) / 1048576,
    };
  } catch (error) {
    return {
      ms: performance.now() - started,
      payload: 0,
      peakRssMb: 0,
      error: (error as Error).message,
    };
  } finally {
    clearInterval(sampler);
  }
}

/** Runs the real restore script in `cloud`, as the workspace does. */
function restore(cloud: string, snapshot: CheckoutSnapshot) {
  const stage = ".gitterm-handoff-0000-bec0";
  execFileSync("node", ["-e", PREPARE_STAGE_SCRIPT, stage], { cwd: cloud });
  writeFileSync(path.join(cloud, stage, "snapshot.bin"), encodeSnapshot(snapshot));
  const started = performance.now();
  const run = spawnSync("node", ["-e", RESTORE_SCRIPT, stage], { cwd: cloud });
  return {
    ms: performance.now() - started,
    ok: run.status === 0 && run.stdout.toString() === "GITTERM_HANDOFF_VERIFIED",
    needsFullHistory: run.status === 3,
  };
}

/** Capture, restore, and the plugin's retry with the whole history when the cloud asks for it. */
async function handoff(directory: string, cloud: string, includeChanges: boolean) {
  const first = await capture(directory, includeChanges);
  if (!first.snapshot)
    return { rejected: first.error!, uploaded: 0, ok: false, fallback: false, ms: 0 };
  let restored = restore(cloud, first.snapshot);
  let uploaded = first.payload;
  let ms = first.ms + restored.ms;
  const fallback = restored.needsFullHistory;
  if (fallback) {
    const full = await capture(directory, includeChanges, true);
    if (!full.snapshot) return { rejected: full.error!, uploaded, ok: false, fallback, ms };
    restored = restore(cloud, full.snapshot);
    uploaded += full.payload;
    ms += full.ms + restored.ms;
  }
  return { rejected: "", uploaded, ok: restored.ok, fallback, ms };
}

/** A bare origin, a local clone with identity set, and a way to make the cloud's fresh clone. */
function fixture(name: string, options: { branch?: string } = {}) {
  const root = path.join(temporary, name);
  const origin = path.join(root, "origin.git");
  const source = path.join(root, "source");
  const seed = path.join(root, "seed");
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-q", "-b", options.branch ?? "main");
  write(seed, "README.md", "# fixture\n");
  write(seed, "src/app.ts", "export const value = 1;\n");
  write(seed, "run.sh", "#!/bin/sh\nexit 0\n");
  write(seed, "logo.bin", new Uint8Array([0, 1, 2, 255]));
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "initial");
  git(root, "clone", "-q", "--bare", seed, origin);
  git(root, "clone", "-q", origin, source);
  return {
    root,
    origin,
    source,
    /**
     * A fresh clone of origin holding only what a network clone would (no unreachable
     * objects); `shallow` is the depth-1 single-branch clone some images make.
     */
    cloud: (shallow = false) => {
      const cloud = path.join(root, `cloud-${crypto.randomUUID().slice(0, 8)}`);
      if (shallow)
        git(root, "clone", "-q", "--depth", "1", "--single-branch", `file://${origin}`, cloud);
      else git(root, "clone", "-q", "--no-local", origin, cloud);
      return cloud;
    },
  };
}

const commit = (root: string, file: string, data: string | Uint8Array, message = "change") => {
  write(root, file, data);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
};

async function repo() {
  const source = path.resolve(flag("repo", path.resolve(import.meta.dir, "../..")));
  console.log(`\n== this repository: ${source}`);
  // What the checkout believes the origin has becomes the origin a workspace would clone.
  const origin = path.join(temporary, "real-origin.git");
  git(temporary, "init", "-q", "--bare", origin);
  git(source, "push", "-q", origin, "refs/remotes/origin/*:refs/heads/*");
  const head = git(source, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(
    "origin/",
    "",
  );
  git(origin, "symbolic-ref", "HEAD", `refs/heads/${head}`);
  const unpushed = Number(git(source, "rev-list", "--count", "HEAD", "--not", "--remotes=origin"));
  console.log(
    `  commits on HEAD: ${git(source, "rev-list", "--count", "HEAD")}, of which not on origin: ${unpushed}`,
  );

  for (const includeChanges of [false, true]) {
    const result = await capture(source, includeChanges);
    if (!result.snapshot) {
      console.log(
        `  capture (changes ${includeChanges ? "included" : "excluded"}): REJECTED: ${result.error}`,
      );
      continue;
    }
    const bundle = Buffer.from(result.snapshot.bundle, "base64").length;
    const cloud = path.join(temporary, `real-cloud-${includeChanges}`);
    git(temporary, "clone", "-q", origin, cloud);
    const restored = restore(cloud, result.snapshot);
    console.log(
      `  changes ${includeChanges ? "included" : "excluded"}: capture ${result.ms.toFixed(0)} ms, peak memory +${result.peakRssMb.toFixed(0)} MB, bundle ${mib(bundle)} MiB, uploaded ${mib(result.payload)} MiB, restore ${restored.ms.toFixed(0)} ms ${restored.ok ? "verified" : "FAILED"}`,
    );
  }
}

async function scale() {
  console.log(
    "\n== history size: origin already has the history, the checkout adds 3 small commits",
  );
  console.log("  history   capture                         bundle    uploaded   restore");
  for (const megabytes of [5, 20, 30, 60]) {
    const f = fixture(`scale-${megabytes}`);
    for (let index = 0; index < megabytes; index += 1)
      commit(f.source, `assets/blob-${index}.bin`, blob(1024 * 1024));
    git(f.source, "push", "-q", "origin", "HEAD");
    for (let index = 0; index < 3; index += 1)
      commit(f.source, `src/feature-${index}.ts`, `export const n = ${index};\n`);
    const result = await capture(f.source, false);
    if (!result.snapshot) {
      console.log(
        `  ${String(megabytes).padStart(4)} MiB  REJECTED after ${result.ms.toFixed(0)} ms: ${result.error}`,
      );
    } else {
      const restored = restore(f.cloud(), result.snapshot);
      console.log(
        `  ${String(megabytes).padStart(4)} MiB  ${result.ms.toFixed(0).padStart(5)} ms, +${result.peakRssMb.toFixed(0).padStart(3)} MB memory   ${mib(Buffer.from(result.snapshot.bundle, "base64").length).padStart(6)} MiB  ${mib(result.payload).padStart(6)} MiB  ${restored.ms.toFixed(0).padStart(5)} ms ${restored.ok ? "verified" : "FAILED"}`,
      );
    }
    rmSync(f.root, { recursive: true, force: true });
  }

  console.log("\n== uncommitted changes: one untracked file of this size");
  for (const megabytes of [1, 10, 24]) {
    const f = fixture(`dirty-${megabytes}`);
    write(f.source, "data/untracked.bin", blob(megabytes * 1024 * 1024));
    const result = await capture(f.source, true);
    const restored = result.snapshot ? restore(f.cloud(), result.snapshot) : null;
    console.log(
      result.snapshot
        ? `  ${String(megabytes).padStart(4)} MiB  capture ${result.ms.toFixed(0).padStart(5)} ms, +${result.peakRssMb.toFixed(0).padStart(3)} MB memory, uploaded ${mib(result.payload)} MiB, restore ${restored!.ms.toFixed(0)} ms ${restored!.ok ? "verified" : "FAILED"}`
        : `  ${String(megabytes).padStart(4)} MiB  REJECTED: ${result.error}`,
    );
    rmSync(f.root, { recursive: true, force: true });
  }
}

type Scenario = {
  name: string;
  /** Returns the directory the session runs in when it is not the checkout root. */
  setup(f: ReturnType<typeof fixture>): string | void;
  options?: { branch?: string };
  includeChanges?: boolean;
  rejected?: boolean;
};

const scenarios: Scenario[] = [
  { name: "clean checkout, everything pushed", setup() {} },
  {
    name: "unpushed commits on a feature branch",
    setup(f) {
      git(f.source, "checkout", "-q", "-b", "feature/login");
      commit(f.source, "src/login.ts", "export const login = true;\n");
      commit(f.source, "src/login.ts", "export const login = false;\n");
    },
  },
  {
    name: "unpushed merge commit",
    setup(f) {
      git(f.source, "checkout", "-q", "-b", "side");
      commit(f.source, "src/side.ts", "export {};\n");
      git(f.source, "checkout", "-q", "main");
      commit(f.source, "src/main.ts", "export {};\n");
      git(f.source, "merge", "-q", "--no-ff", "-m", "merge side", "side");
    },
  },
  {
    name: "detached HEAD",
    setup(f) {
      commit(f.source, "src/a.ts", "export {};\n");
      git(f.source, "checkout", "-q", "--detach");
    },
  },
  {
    name: "origin moved ahead since the last fetch",
    setup(f) {
      const other = path.join(f.root, "other");
      git(f.root, "clone", "-q", f.origin, other);
      commit(other, "src/remote-only.ts", "export {};\n");
      git(other, "push", "-q", "origin", "HEAD");
      commit(f.source, "src/local.ts", "export {};\n");
    },
  },
  {
    name: "default branch force-pushed on origin",
    setup(f) {
      commit(f.source, "src/pushed.ts", "export {};\n");
      git(f.source, "push", "-q", "origin", "HEAD");
      const other = path.join(f.root, "other");
      git(f.root, "clone", "-q", f.origin, other);
      git(other, "reset", "-q", "--hard", "HEAD~1");
      commit(other, "src/rewritten.ts", "export {};\n");
      git(other, "push", "-q", "--force", "origin", "HEAD");
      commit(f.source, "src/local.ts", "export {};\n");
    },
  },
  {
    name: "default branch is not main",
    options: { branch: "trunk" },
    setup(f) {
      commit(f.source, "src/local.ts", "export {};\n");
    },
  },
  {
    name: "shallow local clone (depth 1) with a local commit",
    setup(f) {
      commit(f.source, "src/second.ts", "export {};\n");
      git(f.source, "push", "-q", "origin", "HEAD");
      rmSync(f.source, { recursive: true, force: true });
      git(f.root, "clone", "-q", "--depth", "1", `file://${f.origin}`, f.source);
      commit(f.source, "src/local.ts", "export {};\n");
    },
  },
  {
    name: "session in a linked worktree",
    setup(f) {
      const worktree = path.join(f.root, "worktree");
      git(f.source, "worktree", "add", "-q", "-b", "wt", worktree);
      commit(worktree, "src/in-worktree.ts", "export {};\n");
      return worktree;
    },
  },
  {
    name: "staged rename, mode change, deletion, binary edit",
    includeChanges: true,
    setup(f) {
      git(f.source, "mv", "src/app.ts", "src/main.ts");
      chmodSync(path.join(f.source, "run.sh"), 0o755);
      rmSync(path.join(f.source, "README.md"));
      write(f.source, "logo.bin", new Uint8Array([9, 8, 7, 0, 255]));
    },
  },
  {
    name: "untracked: empty file, unicode name, nested directory",
    includeChanges: true,
    setup(f) {
      write(f.source, "notes/empty.txt", "");
      write(f.source, "notes/résumé — draft.md", "hello\n");
      write(f.source, "deep/a/b/c/file.txt", "nested\n");
    },
  },
  {
    name: "CRLF file edited with core.autocrlf=true",
    includeChanges: true,
    setup(f) {
      git(f.source, "config", "core.autocrlf", "true");
      write(f.source, "src/app.ts", "export const value = 2;\r\nexport const other = 3;\r\n");
      write(f.source, "windows.txt", "line one\r\nline two\r\n");
    },
  },
  {
    name: ".gitattributes eol=crlf on a changed file",
    includeChanges: true,
    setup(f) {
      commit(f.source, ".gitattributes", "*.bat text eol=crlf\n");
      commit(f.source, "build.bat", "echo one\n");
      git(f.source, "push", "-q", "origin", "HEAD");
      write(f.source, "build.bat", "echo one\r\necho two\r\n");
    },
  },
  {
    name: "tracked symlink retargeted",
    includeChanges: true,
    setup(f) {
      symlinkSync("README.md", path.join(f.source, "link"));
      git(f.source, "add", "link");
      git(f.source, "commit", "-q", "-m", "link");
      git(f.source, "push", "-q", "origin", "HEAD");
      rmSync(path.join(f.source, "link"));
      symlinkSync("src/app.ts", path.join(f.source, "link"));
    },
  },
  {
    name: "untracked file of 26 MiB",
    includeChanges: true,
    rejected: true,
    setup(f) {
      write(f.source, "big.bin", blob(26 * 1024 * 1024));
    },
  },
];

async function matrix() {
  console.log("\n== reliability matrix: capture locally, restore into a fresh clone of origin");
  console.log(`  ${"".padEnd(52)} ${"full clone".padEnd(34)} depth-1 clone`);
  let index = 0;
  for (const scenario of scenarios) {
    const cells: string[] = [];
    for (const shallow of [false, true]) {
      const f = fixture(`matrix-${index++}`, scenario.options);
      try {
        const directory = scenario.setup(f) ?? f.source;
        const result = await handoff(directory, f.cloud(shallow), scenario.includeChanges ?? false);
        if (scenario.rejected ? !result.rejected : result.rejected || !result.ok)
          process.exitCode = 1;
        cells.push(
          result.rejected
            ? `rejected before upload`
            : result.ok
              ? `ok, ${mib(result.uploaded)} MiB${result.fallback ? " (2 uploads)" : ""}`
              : `FAILED IN THE CLOUD`,
        );
      } catch (error) {
        process.exitCode = 1;
        cells.push(`fixture error: ${(error as Error).message.split("\n")[0]}`);
      }
      rmSync(f.root, { recursive: true, force: true });
    }
    console.log(`  ${scenario.name.padEnd(52)} ${cells[0]!.padEnd(34)} ${cells[1]}`);
  }
}

try {
  const sections: Record<string, () => Promise<void>> = { repo, scale, matrix };
  for (const name of only) await sections[name]?.();
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
