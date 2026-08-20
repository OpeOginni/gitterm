export const BENCHMARK_RESULT_MARKER = "GITTERM_BENCHMARK_RESULT=";

export type WorkspaceBenchmarkResult = {
  runtime: {
    bunVersion: string;
    platform: string;
    architecture: string;
    cpuModel: string;
    logicalCpus: number;
    totalMemoryMiB: number;
  };
  cpu: {
    iterations: number;
    durationMs: number;
    millionIterationsPerSecond: number;
    checksum: number;
  };
  disk: {
    sizeMiB: number;
    writeDurationMs: number;
    writeMiBPerSecond: number;
    readDurationMs: number;
    readMiBPerSecond: number;
  };
};

export function buildWorkspaceBenchmarkCommand(options: {
  cpuIterations: number;
  diskSizeMiB: number;
}): string {
  const source = `
import { cpus, totalmem } from "node:os";
import { open, readFile, unlink } from "node:fs/promises";

const cpuIterations = ${options.cpuIterations};
const diskSizeMiB = ${options.diskSizeMiB};

function cpuLoop(iterations) {
  let checksum = 0x12345678;
  for (let index = 0; index < iterations; index += 1) {
    checksum = Math.imul(checksum ^ index, 2654435761);
    checksum ^= checksum >>> 13;
  }
  return checksum >>> 0;
}

cpuLoop(Math.min(cpuIterations, 1_000_000));
const cpuStartedAt = performance.now();
const checksum = cpuLoop(cpuIterations);
const cpuDurationMs = performance.now() - cpuStartedAt;

const diskPath = ".gitterm-benchmark-" + Date.now() + ".bin";
const sizeBytes = diskSizeMiB * 1024 * 1024;
const contents = Buffer.alloc(sizeBytes, 0x5a);
let writeDurationMs;
let readDurationMs;
try {
  const file = await open(diskPath, "w");
  const writeStartedAt = performance.now();
  await file.writeFile(contents);
  await file.sync();
  writeDurationMs = performance.now() - writeStartedAt;
  await file.close();

  const readStartedAt = performance.now();
  const readContents = await readFile(diskPath);
  readDurationMs = performance.now() - readStartedAt;
  if (readContents.length !== sizeBytes) throw new Error("Disk benchmark read was incomplete");
} finally {
  await unlink(diskPath).catch(() => undefined);
}

const cpuInfo = cpus();
const result = {
  runtime: {
    bunVersion: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpuInfo[0]?.model ?? "unknown",
    logicalCpus: cpuInfo.length,
    totalMemoryMiB: Math.round(totalmem() / 1024 / 1024),
  },
  cpu: {
    iterations: cpuIterations,
    durationMs: Math.round(cpuDurationMs),
    millionIterationsPerSecond: Number((cpuIterations / cpuDurationMs / 1000).toFixed(2)),
    checksum,
  },
  disk: {
    sizeMiB: diskSizeMiB,
    writeDurationMs: Math.round(writeDurationMs),
    writeMiBPerSecond: Number((diskSizeMiB / (writeDurationMs / 1000)).toFixed(2)),
    readDurationMs: Math.round(readDurationMs),
    readMiBPerSecond: Number((diskSizeMiB / (readDurationMs / 1000)).toFixed(2)),
  },
};
console.log("${BENCHMARK_RESULT_MARKER}" + JSON.stringify(result));
`;
  const encoded = Buffer.from(source).toString("base64");
  return `bun -e 'const path="/tmp/gitterm-provider-benchmark-"+process.pid+".mjs"; await Bun.write(path,Buffer.from("${encoded}","base64")); try { await import(path) } finally { await (await import("node:fs/promises")).unlink(path).catch(()=>undefined) }'`;
}

export function parseWorkspaceBenchmarkLog(log: string | null): WorkspaceBenchmarkResult {
  const resultLine = log?.split("\n").find((line) => line.includes(BENCHMARK_RESULT_MARKER));
  if (!resultLine) throw new Error("Workspace benchmark result was not found in setup output");

  const json = resultLine.slice(
    resultLine.indexOf(BENCHMARK_RESULT_MARKER) + BENCHMARK_RESULT_MARKER.length,
  );
  return JSON.parse(json) as WorkspaceBenchmarkResult;
}
