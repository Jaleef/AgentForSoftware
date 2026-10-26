import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Minimal, dependency-free ZIP reader for DOCX packages.
 * Supports stored (0) and deflate (8) entries, which covers Word output.
 */
export class ZipArchive {
  private buffer: Buffer;
  private entries = new Map<string, ZipEntry>();

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.readCentralDirectory();
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ZIP entry not found: ${name}`);
    const buf = this.buffer;
    const lh = entry.localHeaderOffset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`Invalid local header for ${name}`);
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(data);
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${name}`);
  }

  readText(name: string): string {
    return this.read(name).toString("utf8");
  }

  private readCentralDirectory(): void {
    const buf = this.buffer;
    const min = Math.max(0, buf.length - 0xffff - 22);
    let eocd = -1;
    for (let i = buf.length - 22; i >= min; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a valid ZIP/DOCX file: end of central directory not found");
    const count = buf.readUInt16LE(eocd + 10);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    let ptr = cdOffset;
    for (let i = 0; i < count; i++) {
      if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = buf.readUInt16LE(ptr + 10);
      const compressedSize = buf.readUInt32LE(ptr + 20);
      const uncompressedSize = buf.readUInt32LE(ptr + 24);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const localHeaderOffset = buf.readUInt32LE(ptr + 42);
      const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
      this.entries.set(name.replace(/\\/g, "/"), {
        name,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  }
}
