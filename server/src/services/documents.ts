/**
 * 文档持久化与后台解析服务。
 *
 * 负责 DOCX 落盘、解析结果保存、重新拆分、LLM 整理、统计重算和恢复任务。
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentKind, ParsedDocument, StoredDocument } from "../types.js";
import { parseDocxBuffer } from "../parsers/docx.js";
import { parseRequirements, extractRequirementPoints } from "../parsers/requirements.js";
import { parseDesign, extractDesignPoints } from "../parsers/design.js";
import { LlmClient } from "../llm/client.js";
import { runRequirementAgent } from "../llm/requirements.js";
import { runDesignAgent } from "../llm/design.js";
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

export function recomputeRequirementStats(doc: StoredDocument): void {
  if (doc.kind !== "srs") return;
  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  const byChapter: Record<string, number> = {};
  for (const r of doc.requirements) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    bySubsystem[r.subsystem] = (bySubsystem[r.subsystem] ?? 0) + 1;
    const chapter = r.chapter.split(" / ").slice(-1)[0] || "未分类";
    byChapter[chapter] = (byChapter[chapter] ?? 0) + 1;
  }
  doc.stats.byType = byType;
  doc.stats.bySubsystem = bySubsystem;
  doc.stats.byChapter = byChapter;
  doc.stats.total = doc.requirements.length;
}

export function recomputeDesignStats(doc: StoredDocument): void {
  if (doc.kind !== "sdd") return;
  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  const byChapter: Record<string, number> = {};
  for (const u of doc.designUnits) {
    byType[u.type] = (byType[u.type] ?? 0) + 1;
    bySubsystem[u.subsystem] = (bySubsystem[u.subsystem] ?? 0) + 1;
    const chapter = u.chapter.split(" / ").slice(-1)[0] || "未分类";
    byChapter[chapter] = (byChapter[chapter] ?? 0) + 1;
  }
  doc.stats.byType = byType;
  doc.stats.bySubsystem = bySubsystem;
  doc.stats.byChapter = byChapter;
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

/**
 * 保存上传文档并写入解析结果。
 *
 * 替换同项目同类型旧文档，必要时启动后台 LLM 整理。
 */
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
    requirementPoints: parsed.kind === "srs" ? parsed.requirementPoints : [],
    designUnits: parsed.kind === "sdd" ? parsed.designUnits : [],
    designPoints: parsed.kind === "sdd" ? parsed.designPoints : [],
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

/**
 * 启动文档后台 LLM 整理。
 *
 * 用运行中集合避免重复任务，并在结束后清理状态。
 */
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
  const client = new LlmClient(settings);
  const concurrency = Math.max(1, Math.min(settings.concurrency, 8));

  try {
    // Fail fast before sending dozens of batches to a misconfigured endpoint.
    await client.testConnection();
    // 限制单次整理的最大模型调用数，避免配置错误时无限重试。
    client.setMaxCalls(300);
    if (doc.kind === "srs") {
      // Requirement pipeline: table points + LLM text judgement + LLM unit generation.
      let points = doc.requirementPoints ?? [];
      if (!points.length) {
        const extracted = extractRequirementPoints(parseDocxBuffer(readFileSync(resolveStoredPath(doc))));
        points = extracted.points;
      }
      if (!points.length) throw new Error("未解析到需求点，请先执行「重新拆分」后再让 LLM 生成需求单元。");
      const result = await runRequirementAgent(
        doc.id,
        structuredClone(points),
        client,
        concurrency,
      );
      await mutateStore((data) => {
        const target = data.documents.find((d) => d.id === docId);
        if (!target) return;
        const reviews = new Map(
          target.requirements
            .filter((unit) => unit.pointId && (unit.reviewStatus === "confirmed" || unit.reviewNote))
            .map((unit) => [unit.pointId as string, { reviewStatus: unit.reviewStatus, reviewNote: unit.reviewNote }]),
        );
        target.requirementPoints = result.points;
        target.subsystemTaxonomy = result.taxonomy;
        const manualUnits = target.requirements.filter((unit) => unit.origin === "manual");
        target.requirements = [
          ...result.units.map((unit) => {
            const review = unit.pointId ? reviews.get(unit.pointId) : undefined;
            return review ? { ...unit, ...review } : unit;
          }),
          ...manualUnits,
        ];
        target.status = "parsed";
        target.updatedAt = nowIso();
        const baseWarnings = target.warnings.filter(
          (warning) =>
            !warning.includes("文本型候选需求点") &&
            !warning.includes("规则解析需求点") &&
            !warning.includes("勾选了 LLM") &&
            !warning.startsWith("LLM 已") &&
            !warning.startsWith("LLM 整理") &&
            !warning.startsWith("LLM 未能") &&
            !warning.startsWith("LLM 解析失败") &&
            !warning.startsWith("文本型需求点") &&
            !warning.startsWith("文本需求点判定失败") &&
            !warning.startsWith("需求单元生成失败"),
        );
        target.warnings = [
          ...baseWarnings,
          `规则解析需求点 ${result.tablePoints} 个（需求表，置信度 100%）；文本候选 ${result.textPoints} 个，LLM 判定为需求 ${result.acceptedTextPoints} 个；归纳子系统类别 ${result.taxonomy.length} 个；生成需求单元 ${result.units.length} 个。`,
          ...result.warnings,
        ];
        recomputeRequirementStats(target);
      });
      return;
    }

    // Design pipeline: structured tables + LLM judgement of text/database candidates.
    let points = doc.designPoints ?? [];
    if (!points.length) {
      const extracted = extractDesignPoints(parseDocxBuffer(readFileSync(resolveStoredPath(doc))));
      points = extracted.points;
    }
    if (!points.length) throw new Error("未解析到设计点，请先执行「重新拆分」后再让 LLM 生成设计单元。");
    const result = await runDesignAgent(
      doc.id,
      structuredClone(points),
      client,
      concurrency,
    );
    await mutateStore((data) => {
      const target = data.documents.find((d) => d.id === docId);
      if (!target) return;
      const reviews = new Map(
        target.designUnits
          .filter((unit) => unit.pointId && (unit.reviewStatus === "confirmed" || unit.reviewNote))
          .map((unit) => [unit.pointId as string, { reviewStatus: unit.reviewStatus, reviewNote: unit.reviewNote }]),
      );
      target.designPoints = result.points;
      target.designSubsystemTaxonomy = result.taxonomy;
      const manualUnits = target.designUnits.filter((unit) => unit.origin === "manual");
      target.designUnits = [
        ...result.units.map((unit) => {
          const review = unit.pointId ? reviews.get(unit.pointId) : undefined;
          return review ? { ...unit, ...review } : unit;
        }),
        ...manualUnits,
      ];
      target.status = "parsed";
      target.updatedAt = nowIso();
      const baseWarnings = target.warnings.filter(
        (warning) =>
          !warning.includes("文本设计候选") &&
          !warning.includes("数据库表候选") &&
          !warning.includes("未识别到结构化设计表") &&
          !warning.includes("未识别到模块/子功能设计单元") &&
          !warning.includes("未识别到数据库表设计") &&
          !warning.includes("规则解析设计点") &&
          !warning.includes("勾选了 LLM") &&
          !warning.startsWith("LLM 已") &&
          !warning.startsWith("LLM 整理") &&
          !warning.startsWith("LLM 未能") &&
          !warning.startsWith("LLM 解析失败") &&
          !warning.startsWith("设计点判定失败") &&
          !warning.startsWith("设计单元生成失败"),
      );
      target.warnings = [
        ...baseWarnings,
        `规则解析设计点 ${result.tablePoints} 个（设计表，置信度 100%）；数据库表候选 ${result.databasePoints} 个，LLM 判定 ${result.acceptedDatabasePoints} 个；文本候选 ${result.textPoints} 个，LLM 判定 ${result.acceptedTextPoints} 个；归纳子系统类别 ${result.taxonomy.length} 个；生成设计单元 ${result.units.length} 个。`,
        ...result.warnings,
      ];
      recomputeDesignStats(target);
    });
  } catch (err) {
    await mutateStore((data) => {
      const target = data.documents.find((d) => d.id === docId);
      if (!target) return;
      target.status = "parsed";
      target.updatedAt = nowIso();
      const baseWarnings = target.warnings.filter(
        (warning) =>
          !warning.startsWith("LLM 解析失败") &&
          !warning.startsWith("LLM 请求失败"),
      );
      target.warnings = [
        ...baseWarnings,
        `LLM 解析失败，已保留规则拆分结果：${(err as Error).message}`,
      ];
    });
  }
}

export function resolveStoredPath(doc: StoredDocument): string {
  return join(projectDir(doc.projectId), doc.filename);
}

/**
 * 重新解析已上传文档。
 *
 * 保留人工新增单元，刷新需求点/设计点、统计和轮廓。
 */
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
    if (parsed.kind === "srs") {
      const manualUnits = target.requirements.filter((unit) => unit.origin === "manual");
      target.requirements = [...parsed.requirements, ...manualUnits];
      target.requirementPoints = parsed.requirementPoints;
      target.subsystemTaxonomy = undefined;
      recomputeRequirementStats(target);
    } else {
      const manualUnits = target.designUnits.filter((unit) => unit.origin === "manual");
      target.designUnits = [...parsed.designUnits, ...manualUnits];
      target.designPoints = parsed.designPoints;
      target.designSubsystemTaxonomy = undefined;
      recomputeDesignStats(target);
    }
    return target;
  });
}

/**
 * 生成文档列表摘要。
 *
 * 避免把完整需求点/设计点列表传给列表接口。
 */
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
    requirementPointCount: (doc.requirementPoints ?? []).length,
    designCount: doc.designUnits.length,
    designPointCount: (doc.designPoints ?? []).length,
  };
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

