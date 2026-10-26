import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { CodeFile, CodeSnapshot, CodeSymbol, CodeSymbolKind } from "../types.js";
import { cleanText } from "../util/text.js";
import { newId, nowIso } from "../util/id.js";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "vendor",
  ".next",
  ".nuxt",
  "coverage",
  ".idea",
  ".vscode",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "logs",
  "tmp",
  ".cache",
  ".turbo",
]);

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".vue": "Vue",
  ".java": "Java",
  ".kt": "Kotlin",
  ".py": "Python",
  ".go": "Go",
  ".cs": "C#",
  ".rs": "Rust",
  ".sql": "SQL",
  ".prisma": "Prisma",
};

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 400 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_SYMBOLS_PER_FILE = 200;

interface WalkResult {
  files: string[];
  skipped: number;
  truncated: boolean;
  warnings: string[];
}

function walk(root: string): WalkResult {
  const files: string[] = [];
  let skipped = 0;
  let truncated = false;
  const warnings: string[] = [];
  let totalBytes = 0;

  const visit = (dir: string): void => {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped++;
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          skipped++;
          continue;
        }
        visit(full);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS[ext]) {
          skipped++;
          continue;
        }
        if (entry.name.endsWith(".min.js") || entry.name.endsWith(".min.css") || entry.name.endsWith(".map")) {
          skipped++;
          continue;
        }
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          skipped++;
          continue;
        }
        if (size > MAX_FILE_BYTES) {
          skipped++;
          continue;
        }
        if (totalBytes + size > MAX_TOTAL_BYTES) {
          truncated = true;
          return;
        }
        totalBytes += size;
        files.push(full);
      }
    }
  };
  visit(root);
  if (truncated) warnings.push(`代码目录过大，仅扫描前 ${MAX_FILES} 个文件（上限 ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB）。`);
  return { files, skipped, truncated, warnings };
}

function snippetAt(lines: string[], line: number, before = 1, after = 10): string {
  const start = Math.max(0, line - 1 - before);
  const end = Math.min(lines.length, line + after);
  return lines
    .slice(start, end)
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .slice(0, 520);
}

interface SymbolDraft {
  kind: CodeSymbolKind;
  name: string;
  line: number;
  signature: string;
}

function pushSymbol(list: SymbolDraft[], kind: CodeSymbolKind, name: string, line: number, signature: string): void {
  if (!name || name.length > 120) return;
  list.push({ kind, name, line, signature: signature.slice(0, 240) });
}

const C_LIKE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".java", ".kt", ".cs", ".go", ".rs"]);

export function extractSymbols(filePath: string, content: string): SymbolDraft[] {
  const ext = extname(filePath).toLowerCase();
  const lines = content.split(/\r?\n/);
  const out: SymbolDraft[] = [];
  const max = Math.min(lines.length, 20000);

  for (let i = 0; i < max; i++) {
    const line = lines[i];
    if (line.length > 1000) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // HTTP routes: Express/Fastify/NestJS, Flask/FastAPI, Spring.
    let m = line.match(
      /\b[A-Za-z_$][\w$]*\s*\.\s*(get|post|put|delete|patch|all)\s*\(\s*['"`](\/[^'"`]*)['"`]/,
    );
    if (m) {
      pushSymbol(out, "route", `${m[1].toUpperCase()} ${m[2]}`, i + 1, trimmed);
      continue;
    }
    m = line.match(/@(Get|Post|Put|Delete|Patch)\(\s*['"`]([^'"`]*)['"`]/);
    if (m) {
      pushSymbol(out, "route", `${m[1].toUpperCase()} ${m[2] || "/"}`, i + 1, trimmed);
      continue;
    }
    m = line.match(/@(?:Request|Get|Post|Put|Delete|Patch)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
    if (m) {
      pushSymbol(out, "route", m[1], i + 1, trimmed);
      continue;
    }
    m = line.match(/@(?:app|router)\.(get|post|put|delete|patch|route)\(\s*["']([^"']+)["']/);
    if (m) {
      pushSymbol(out, "route", `${m[1].toUpperCase()} ${m[2]}`, i + 1, trimmed);
      continue;
    }

    if (C_LIKE_EXT.has(ext)) {
      m = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        pushSymbol(out, "class", m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        pushSymbol(out, "interface", m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        pushSymbol(out, "enum", m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
      if (m) {
        const kind: CodeSymbolKind = /^[A-Z]/.test(m[1]) ? "component" : "function";
        pushSymbol(out, kind, m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
      if (m) {
        const kind: CodeSymbolKind = /^[A-Z]/.test(m[1]) ? "component" : "function";
        pushSymbol(out, kind, m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?[\w<>\[\],.?]+\s+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*\{/);
      if (m && m[1] !== "if" && m[1] !== "for" && m[1] !== "while" && m[1] !== "switch") {
        pushSymbol(out, "method", m[1], i + 1, trimmed);
        continue;
      }
      // Class method shorthand: name(args) { ... } (indented, no control keywords).
      m = line.match(/^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/);
      if (
        m &&
        !["if", "for", "while", "switch", "catch", "constructor", "return", "else", "try", "function"].includes(m[1])
      ) {
        pushSymbol(out, "method", m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:defineComponent|createRouter|express|fastify)\s*\(/);
      if (m) {
        pushSymbol(out, "function", m[1], i + 1, trimmed);
        continue;
      }
    }

    if (ext === ".py") {
      m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
      if (m) {
        const kind: CodeSymbolKind = /^[A-Z]/.test(m[1]) ? "class" : "function";
        pushSymbol(out, kind, m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^\s*class\s+([A-Za-z_]\w*)/);
      if (m) {
        pushSymbol(out, "class", m[1], i + 1, trimmed);
        continue;
      }
    }

    if (ext === ".go") {
      m = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
      if (m) {
        pushSymbol(out, "function", m[1], i + 1, trimmed);
        continue;
      }
      m = line.match(/^type\s+([A-Za-z_]\w*)\s+struct/);
      if (m) {
        pushSymbol(out, "class", m[1], i + 1, trimmed);
        continue;
      }
    }

    if (ext === ".sql") {
      m = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([\w.]+)/i);
      if (m) {
        pushSymbol(out, "table", m[1], i + 1, trimmed);
        continue;
      }
    }

    if (ext === ".prisma") {
      m = line.match(/^model\s+([A-Za-z_]\w*)\s*\{/);
      if (m) {
        pushSymbol(out, "model", m[1], i + 1, trimmed);
        continue;
      }
    }

    if (ext === ".ts" || ext === ".js") {
      m = line.match(/@Entity\(\s*(?:['"]([^'"]+)['"])?/);
      if (m) {
        const nameGuess = lines.slice(i + 1, i + 4).find((l) => /class\s+\w+/.test(l));
        const name = nameGuess?.match(/class\s+(\w+)/)?.[1] ?? "Entity";
        pushSymbol(out, "model", m[1] || name, i + 1, trimmed);
        continue;
      }
      m = line.match(/(?:sequelize\.define|mongoose\.model)\(\s*['"]([^'"]+)['"]/);
      if (m) {
        pushSymbol(out, "model", m[1], i + 1, trimmed);
        continue;
      }
    }

    if (out.length >= MAX_SYMBOLS_PER_FILE) break;
  }

  if (out.length <= 1 && lines.length < 40 && /^\s*<template>/m.test(content)) {
    pushSymbol(out, "component", extname(filePath), 1, filePath);
  }
  return out;
}

function commitOf(root: string, provided: string): string {
  if (provided) return provided;
  try {
    return execFileSync("git", ["-c", "safe.directory=*", "-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

export function scanCodeSnapshot(projectId: string, rootPathRaw: string, commitRaw = ""): CodeSnapshot {
  const root = resolve(rootPathRaw);
  if (!existsSync(root)) throw new Error(`代码目录不存在：${root}`);
  if (!statSync(root).isDirectory()) throw new Error(`代码路径不是目录：${root}`);
  const walkResult = walk(root);
  if (walkResult.files.length === 0) {
    throw new Error("目录中未找到可静态解析的代码文件（支持 .ts/.tsx/.js/.jsx/.vue/.java/.py/.go/.cs/.rs/.sql/.prisma）");
  }

  const files: CodeFile[] = [];
  const byLanguage: Record<string, number> = {};
  let totalLines = 0;
  let symbolCount = 0;
  let routeCount = 0;
  let modelCount = 0;

  for (const full of walkResult.files) {
    const rel = relative(root, full).split(sep).join("/");
    const ext = extname(full).toLowerCase();
    let content = "";
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const language = SUPPORTED_EXTENSIONS[ext] ?? "Other";
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    const lines = content.split(/\r?\n/).length;
    totalLines += lines;
    const drafts = extractSymbols(rel, content);
    const symbols: CodeSymbol[] = drafts.map((d, idx) => ({
      id: `${rel}#${d.line}#${idx}`,
      kind: d.kind,
      name: d.name,
      file: rel,
      line: d.line,
      signature: d.signature,
      snippet: snippetAt(content.split(/\r?\n/), d.line),
    }));
    symbolCount += symbols.length;
    routeCount += symbols.filter((s) => s.kind === "route").length;
    modelCount += symbols.filter((s) => s.kind === "model" || s.kind === "table").length;
    files.push({ path: rel, language, bytes: Buffer.byteLength(content, "utf8"), lines, symbols });
  }

  return {
    id: newId("snap"),
    projectId,
    rootPath: root,
    commit: commitOf(root, commitRaw),
    createdAt: nowIso(),
    status: "ready",
    files,
    stats: {
      files: files.length,
      lines: totalLines,
      symbols: symbolCount,
      routes: routeCount,
      models: modelCount,
      byLanguage,
      skipped: walkResult.skipped,
    },
    warnings: walkResult.warnings,
  };
}

export interface CodeTree {
  name: string;
  path: string;
  type: "dir" | "file";
  fileCount: number;
  files?: CodeFile[];
  children?: CodeTree[];
}

export function buildCodeTree(files: CodeFile[]): CodeTree {
  const root: CodeTree = { name: "", path: "", type: "dir", fileCount: 0, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    let path = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      path = path ? `${path}/${part}` : part;
      const isFile = i === parts.length - 1;
      node.children ??= [];
      let next = node.children.find((c) => c.name === part && c.type === (isFile ? "file" : "dir"));
      if (!next) {
        next = isFile
          ? { name: part, path, type: "file", fileCount: 1, files: [file] }
          : { name: part, path, type: "dir", fileCount: 0, children: [] };
        node.children.push(next);
      }
      if (isFile) next.files = [file];
      node = next;
    }
  }
  const count = (node: CodeTree): number => {
    if (node.type === "file") return 1;
    node.children ??= [];
    node.fileCount = node.children.reduce((acc, c) => acc + count(c), 0);
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return node.fileCount;
  };
  count(root);
  return root;
}

export function flattenSymbols(snapshot: CodeSnapshot): CodeSymbol[] {
  return snapshot.files.flatMap((f) => f.symbols);
}

export function codeContextFor(snapshot: CodeSnapshot, limitFiles = 120): string {
  return snapshot.files
    .slice(0, limitFiles)
    .map((f) => `${f.path} (${f.language}, ${f.lines} 行)`)
    .join("\n");
}

export function fileLanguageCount(snapshot: CodeSnapshot): string {
  return Object.entries(snapshot.stats.byLanguage)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

export function safeClean(text: string): string {
  return cleanText(text);
}
