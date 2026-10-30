import { gzipSync } from "node:zlib";

/** A minimal POSIX (pax) tar writer, so archives are byte-identical on every platform. */

export type TarEntry =
  | { path: string; type: "file"; data: Uint8Array; executable: boolean }
  | { path: string; type: "symlink"; target: string };

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function header(
  name: string,
  options: { size: number; mode: number; type: string; link?: string },
) {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, "utf8");
  block.write(octal(options.mode, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(options.size, 12), 124, "ascii");
  block.write(octal(0, 12), 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write(options.type, 156, "ascii");
  if (options.link) block.write(options.link, 157, 100, "utf8");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + " ", 148, "ascii");
  return block;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  const bytes = Buffer.byteLength(body);
  // The length field counts its own digits.
  let length = bytes + 1;
  while (String(length).length + bytes !== length) length = String(length).length + bytes;
  return Buffer.from(`${length}${body}`);
}

function padded(data: Uint8Array): Buffer[] {
  const remainder = data.byteLength % BLOCK;
  return remainder ? [Buffer.from(data), Buffer.alloc(BLOCK - remainder)] : [Buffer.from(data)];
}

export function createTarGz(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const link = entry.type === "symlink" ? entry.target : undefined;
    // Long or non-ASCII names go in a pax header; the ustar name is a placeholder.
    const needsPax =
      Buffer.byteLength(entry.path) > 99 ||
      /[^\x20-\x7e]/.test(entry.path) ||
      (link !== undefined && (Buffer.byteLength(link) > 99 || /[^\x20-\x7e]/.test(link)));
    if (needsPax) {
      const records = Buffer.concat([
        paxRecord("path", entry.path),
        ...(link !== undefined ? [paxRecord("linkpath", link)] : []),
      ]);
      chunks.push(header("pax-header", { size: records.length, mode: 0o644, type: "x" }));
      chunks.push(...padded(records));
    }
    const name = needsPax ? `gitterm-pax/${chunks.length}` : entry.path;
    if (entry.type === "symlink") {
      chunks.push(header(name, { size: 0, mode: 0o777, type: "2", link: needsPax ? "" : link }));
    } else {
      chunks.push(
        header(name, {
          size: entry.data.byteLength,
          mode: entry.executable ? 0o755 : 0o644,
          type: "0",
        }),
      );
      chunks.push(...padded(entry.data));
    }
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(chunks));
}
