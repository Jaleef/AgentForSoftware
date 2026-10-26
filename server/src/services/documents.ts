import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentKind, DocumentStats, ParsedDocument, StoredDocument } from "../types.js";
import { parseDocxBuffer } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { enrichDocument } from "../llm/enrich.js";
import { LlmClient } from "../llm/client.js";
import {
  ensureProjectDir,
  getStore,
  mutateStore,
  projectDir,
  readSettings,
} from "../store.js";
import { newId, nowIso, sha256 } from "../util/id.js";

export function decodeFilename(name: string): string {
  if (!/[\u00c0-\u00ff]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return decoded.includes("\uFFFD") ? name : decoded;
  } catch {
    return name;
  }
}

export function versionFromFilename(name: string): string {
  const matches = name.match(/[Vv]\s*(\d+(?:\.\d+){0,3})/g) ?? [];
  if (matches.length) {
    const last = matches[matches.length - 1];
    return last.replace(/^[Vv]\s*/, "").trim();
  }
  const plain = name.match(/(\d+\.\d+(?:\.\d+){0,2})/);
  return plain ? plain[1] : "未标版本";
}

export function parseBuffer(buffer: Buffer, kind: DocumentKind): ParsedDocument {
  const docx = parseDocxBuffer(buffer);
  return kind === "srs" ? parseRequirements(docx) : parseDesign(docx);
}

export function statsFor(doc: StoredDocument): DocumentStats {
  return doc.stats;
}

export function recomputeRequirementStats(doc: StoredDocument): void {
  if (doc.kind !== "srs") return;
  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  for (const r of doc.requirements) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    bySubsystem[r.subsystem] = (bySubsystem[r.subsystem] ?? 0) + 1;
  }
  doc.stats.byType = byType;
  doc.stats.bySubsystem = bySubsystem;
  doc.stats.total = doc.requirements.length;
}

export function recomputeDesignStats(doc: StoredDocument): void {
  if (doc.kind !== "sdd") return;
  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  for (const u of doc.designUnits) {
    byType[u.type] = (byType[u.type] ?? 0) + 1;
    bySubsystem[u.subsystem] = (bySubsystem[u.subsystem] ?? 0) + 1;
  }
  doc.stats.byType = byType;
  doc.stats.bySubsystem = bySubsystem;
  doc.stats.total = doc.designUnits.length;
}

export interface SaveParsedOptions {
  projectId: string;
  kind: DocumentKind;
  originalName: string;
  buffer: Buffer;
  useLlm: boolean;
  version?: string;
}

export async function saveParsedDocument(options: SaveParsedOptions): Promise<StoredDocument> {
  const parsed = parseBuffer(options.buffer, options.kind);
  const dir = ensureProjectDir(options.projectId);
  const safeName = options.originalName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const filename = `${options.kind}-${Date.now()}-${safeName.endsWith(".docx") ? safeName : `${safeName}.docx`}`;
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, options.buffer);

  const now = nowIso();
  const doc: StoredDocument = {
    id: newId("doc"),
    projectId: options.projectId,
    kind: options.kind,
    filename,
    originalName: options.originalName,
    size: options.buffer.length,
    sha256: sha256(options.buffer),
    version: options.version || versionFromFilename(options.originalName),
    uploadedAt: now,
    updatedAt: now,
    status: "parsed",
    useLlm: options.useLlm,
    pageCount: parsed.pageCount,
    requirements: parsed.kind === "srs" ? parsed.requirements : [],
    designUnits: parsed.kind === "sdd" ? parsed.designUnits : [],
    outline: parsed.outline,
    stats: parsed.stats,
    warnings: parsed.warnings,
  };

  const oldFiles = await mutateStore((data) => {
    const previous = data.documents.filter((d) => d.projectId === options.projectId && d.kind === options.kind);
    const removed = previous.map((d) => d.filename);
    data.documents = data.documents.filter((d) => !(d.projectId === options.projectId && d.kind === options.kind));
    data.documents.push(doc);
    const project = data.projects.find((p) => p.id === options.projectId);
    if (project) project.updatedAt = now;
    return removed;
  });
  for (const old of oldFiles) {
    try {
      const path = join(projectDir(options.projectId), old);
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* ignore */
    }
  }

  const settings = readSettings().llm;
  if (options.useLlm && !settings.mock && settings.apiKey) {
    doc.status = "enriching";
    void runEnrichment(doc.id);
  } else if (options.useLlm) {
    doc.warnings = [...doc.warnings, "勾选了 LLM 总结/分类，但未配置可用的 LLM，已保留规则拆分结果。"];
    await mutateStore((data) => {
      const target = data.documents.find((d) => d.id === doc.id);
      if (target) {
        target.status = "parsed";
        target.warnings = [...doc.warnings];
      }
    });
  }
  return doc;
}

const enrichingDocs = new Set<string>();

export async function runEnrichment(docId: string): Promise<void> {
  if (enrichingDocs.has(docId)) return;
  enrichingDocs.add(docId);
  try {
    await runEnrichmentInternal(docId);
  } finally {
    enrichingDocs.delete(docId);
  }
}

async function runEnrichmentInternal(docId: string): Promise<void> {
  const store = await getStore();
  const doc = store.documents.find((d) => d.id === docId);
  if (!doc) return;
  const settings = readSettings().llm;
  if (!settings.apiKey || settings.mock) {
    await mutateStore((data) => {
      const target = data.documents.find((d) => d.id === docId);
      if (target) target.status = "parsed";
    });
    return;
  }
  const clone: StoredDocument = {
    ...doc,
    requirements: structuredClone(doc.requirements),
    designUnits: structuredClone(doc.designUnits),
  };
  try {
    const client = new LlmClient(settings);
    const result = await enrichDocument(clone, client, Math.max(1, Math.min(settings.concurrency, 4)));
    await mutateStore((data) => {
      const target = data.documents.find((d) => d.id === docId);
      if (!target) return;
      // Preserve human review decisions made while the LLM was working.
      const reviews = new Map(
        [...target.requirements, ...target.designUnits]
          .filter((unit) => unit.reviewStatus === "confirmed" || unit.reviewNote)
          .map((unit) => [unit.code, { reviewStatus: unit.reviewStatus, reviewNote: unit.reviewNote }]),
      );
      const applyReview = <T extends { code: string; reviewStatus: "pending" | "confirmed"; reviewNote: string }>(unit: T): T => {
        const review = reviews.get(unit.code);
        if (!review) return unit;
        return { ...unit, reviewStatus: review.reviewStatus, reviewNote: review.reviewNote };
      };
      target.requirements = clone.requirements.map(applyReview);
      target.designUnits = clone.designUnits.map(applyReview);
      target.status = "parsed";
      target.updatedAt = nowIso();
      target.warnings = [
        ...target.warnings.filter((w) => !w.startsWith("LLM 整理")),
        ...(result.updated > 0 ? [`LLM 已整理 ${result.updated} 个单元（摘要/义务/分类）。`] : []),
        ...result.warnings.map((w) => `LLM 整理未完全成功：${w}`),
      ];
      target.stats.total = target.kind === "srs" ? target.requirements.length : target.designUnits.length;
      recomputeRequirementStats(target);
      recomputeDesignStats(target);
    });
  } catch (err) {
    await mutateStore((data) => {
      const target = data.documents.find((d) => d.id === docId);
      if (!target) return;
      target.status = "parsed";
      target.updatedAt = nowIso();
      target.warnings = [...target.warnings, `LLM 整理失败，已保留规则拆分结果：${(err as Error).message}`];
    });
  }
}

export function resolveStoredPath(doc: StoredDocument): string {
  return join(projectDir(doc.projectId), doc.filename);
}

export async function reparseDocument(docId: string): Promise<StoredDocument | undefined> {
  const store = await getStore();
  const doc = store.documents.find((d) => d.id === docId);
  if (!doc) return undefined;
  const buffer = readFileSync(resolveStoredPath(doc));
  const parsed = parseBuffer(buffer, doc.kind);
  return mutateStore((data) => {
    const target = data.documents.find((d) => d.id === docId);
    if (!target) return undefined;
    target.status = "parsed";
    target.updatedAt = nowIso();
    target.pageCount = parsed.pageCount;
    target.outline = parsed.outline;
    target.stats = parsed.stats;
    target.warnings = parsed.warnings;
    if (parsed.kind === "srs") target.requirements = parsed.requirements;
    else target.designUnits = parsed.designUnits;
    return target;
  });
}

export function documentSummary(doc: StoredDocument) {
  return {
    id: doc.id,
    projectId: doc.projectId,
    kind: doc.kind,
    originalName: doc.originalName,
    version: doc.version,
    size: doc.size,
    sha256: doc.sha256,
    uploadedAt: doc.uploadedAt,
    updatedAt: doc.updatedAt,
    status: doc.status,
    useLlm: doc.useLlm,
    error: doc.error,
    pageCount: doc.pageCount,
    stats: doc.stats,
    warnings: doc.warnings,
    requirementCount: doc.requirements.length,
    designCount: doc.designUnits.length,
  };
}

export function ensureProjectUploadDir(projectId: string): string {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function recoverInterruptedDocuments(): void {
  void mutateStore((data) => {
    for (const doc of data.documents) {
      if (doc.status === "enriching" || doc.status === "parsing") {
        doc.status = "parsed";
        doc.updatedAt = nowIso();
        const warning = "LLM 整理因服务重启中断，已保留规则拆分结果；可重新执行「LLM 整理」。";
        if (!doc.warnings.includes(warning)) doc.warnings.push(warning);
      }
    }
  });
}
