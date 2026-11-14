/**
 * DOCX ZIP 解包适配层。
 *
 * 调用 fflate.unzipSync 解析 DOCX 的 OOXML 包；对外保留原有 ZipArchive
 * 接口，避免 docx.ts 依赖第三方库。fflate 是纯 JS、无原生编译依赖，
 * 支持 Word 常见的 stored/deflate entry。
 */

import { unzipSync } from "fflate";

/**
 * 最小 ZIP 读取器。
 *
 * 输入：完整 DOCX Buffer。
 * 输出：按 entry 名称读取的 Buffer/Text。
 * 失败：非法 ZIP、加密 ZIP 或损坏 entry 抛出带 DOCX 语义的错误。
 */
export class ZipArchive {
  private entries: Map<string, Uint8Array>;

  constructor(buffer: Buffer) {
    try {
      const entries = unzipSync(new Uint8Array(buffer));
      this.entries = new Map(
        Object.entries(entries).map(([name, data]) => [name.replace(/\\/g, "/"), data]),
      );
    } catch (error) {
      throw new Error(`无法解压 DOCX 压缩包：${(error as Error).message}`);
    }
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`DOCX 压缩包缺少 entry：${name}`);
    return Buffer.from(entry);
  }

  readText(name: string): string {
    return this.read(name).toString("utf8");
  }
}
