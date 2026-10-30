/**
 * 需求文档解析与需求点抽取。
 *
 * 需求表直接生成规则点；纯文字叶子章节作为 LLM 候选；生成规则回退需求和稳定编号。
 */

import type {
  DocumentStats,
  OutlineNode,
  ParsedRequirements,
  RequirementPoint,
  RequirementType,
  RequirementUnit,
} from "../types.js";
import type { DocxDocument, DocxParagraph, DocxTable } from "./docx.js";
import { tablePairs } from "./docx.js";
import { cleanText, extractKeywords, firstSentences, splitSentences } from "../util/text.js";
import { buildOutline } from "./outline.js";

export const REQUIREMENT_TYPE_PREFIX: Record<RequirementType, string> = {
  功能需求: "FR",
  性能需求: "PERF",
  "页面/人机交互需求": "UI",
  接口需求: "IF",
  数据需求: "DATA",
  环境需求: "ENV",
  安全保密需求: "SEC",
  设计实现约束: "CON",
  验收交付需求: "DEL",
  质量属性需求: "QA",
  元数据需求: "META",
  用例需求: "UC",
  其他需求: "OTH",
};

const LABELS = new Set([
  "需求ID",
  "父需求ID",
  "需求描述",
  "需求说明",
  "测试规程",
  "需求名称",
  "优先级",
]);

export interface RequirementPointExtraction {
  points: RequirementPoint[];
  outline: OutlineNode[];
  stats: DocumentStats;
  warnings: string[];
}

interface Section {
  path: string[];
  level: number;
  paragraphs: Array<{ paragraph: DocxParagraph; order: number }>;
  hasRequirementTable: boolean;
  hasTable: boolean;
}

/** A requirement table is recognised by labels only, not by its chapter name. */
export function isRequirementTable(table: DocxTable): boolean {
  const pairs = tablePairs(table);
  const labels = new Set(pairs.map((pair) => pair.label));
  return (
    (labels.has("需求描述") || labels.has("需求名称")) &&
    (labels.has("需求说明") || labels.has("测试规程") || labels.has("需求ID"))
  );
}

function pairMap(table: DocxTable): Map<string, string> {
  const map = new Map<string, string>();
  for (const { label, value } of tablePairs(table)) {
    if (!LABELS.has(label)) continue;
    if (!map.has(label)) map.set(label, value);
  }
  return map;
}

function previewTitle(text: string): string {
  return firstSentences(text, 64);
}

function pointObligations(description: string, detail: string): string[] {
  return splitSentences(`${description}。${detail}`)
    .map((sentence) => sentence.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
    .filter((sentence) => sentence.length >= 6)
    .slice(0, 8);
}

/** Extract an optional source id such as "SAF-1:" or "REQ_001:" from a standalone paragraph. */
function splitTextLabel(text: string): { sourceId: string; body: string } {
  const match = text.match(/^([A-Za-z][A-Za-z0-9_-]{1,20}[-_ ]?\d+)\s*[:：]\s*(.*)$/);
  if (match) return { sourceId: match[1].replace(/\s+/g, ""), body: match[2].trim() || text };
  return { sourceId: "", body: text };
}

/**
 * Text-only paragraphs are candidates, not requirements. They are sent to the LLM
 * for judgement. This filter only drops obvious non-body text (TOC/captions/labels).
 */
function isTextCandidateParagraph(paragraph: DocxParagraph): boolean {
  if (paragraph.isToc || paragraph.headingLevel > 0) return false;
  const style = (paragraph.styleName || "").toLowerCase();
  if (style.includes("图标题") || style.includes("caption")) return false;
  const text = cleanText(paragraph.text);
  if (text.length < 10) return false;
  if (/^[0-9]+[）)]\s*\S{1,14}$/.test(text)) return false;
  if (/^(如图|见表|如下表|上图|下图|图\s*\d|表\s*\d)/.test(text)) return false;
  if (text.length < 80 && /(示意图|流程图|结构图|用例图|逻辑图|跳转图|划分图|图)$/.test(text)) return false;
  if (/[：:]$/.test(text) && text.length < 30) return false;
  if (/^(注|说明)[：:]/.test(text) && text.length < 30) return false;
  return true;
}

function buildStats(doc: DocxDocument, units: RequirementUnit[]): DocumentStats {
  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  const byChapter: Record<string, number> = {};
  for (const unit of units) {
    byType[unit.type] = (byType[unit.type] ?? 0) + 1;
    bySubsystem[unit.subsystem] = (bySubsystem[unit.subsystem] ?? 0) + 1;
    const chapter = unit.chapter.split(" / ").slice(-1)[0] || "未分类";
    byChapter[chapter] = (byChapter[chapter] ?? 0) + 1;
  }
  return {
    total: units.length,
    byType,
    bySubsystem,
    byChapter,
    pages: doc.pageCount,
    tables: doc.tables.length,
    paragraphs: doc.paragraphs.length,
  };
}

/**
 * Stage 1 of the new pipeline:
 * - requirement table  -> trusted requirement point (origin "rule", confidence 1.0)
 * - text-only section  -> candidate point (origin "llm", pending judgement)
 *
 * No requirement type/subsystem is inferred from chapter names here.
 */
export function extractRequirementPoints(doc: DocxDocument): RequirementPointExtraction {
  const warnings: string[] = [];
  const points: Array<RequirementPoint & { order: number }> = [];
  const sections: Section[] = [];
  const headingStack: Array<{ level: number; title: string; number: string }> = [];
  const levelCounters: number[] = [];
  const seenTables = new Set<string>();
  const seenTexts = new Set<string>();
  let malformedTables = 0;
  let tablePoints = 0;
  let textCandidates = 0;
  let currentSection: Section | null = null;

  const chapterPathOf = (): string[] =>
    headingStack.map((heading) => `${heading.number} ${heading.title}`);
  const chapterOf = (): string => {
    const path = chapterPathOf();
    return path.length ? path.join(" / ") : "未分类";
  };

  const pushTablePoint = (table: DocxTable, order: number): void => {
    if (!isRequirementTable(table)) return;
    const pairs = pairMap(table);
    const description = cleanText(pairs.get("需求描述") || pairs.get("需求名称") || "");
    const detail = cleanText(pairs.get("需求说明") || "");
    if (!description && !detail) {
      malformedTables++;
      return;
    }
    const key = `${description}::${detail}`;
    if (seenTables.has(key)) return;
    seenTables.add(key);
    tablePoints++;
    if (currentSection) currentSection.hasRequirementTable = true;
    points.push({
      id: "",
      order,
      kind: "table",
      origin: "rule",
      confidence: 1,
      chapter: chapterOf(),
      chapterPath: chapterPathOf(),
      location: { page: table.page, line: table.line },
      sourceId: cleanText(pairs.get("需求ID") || ""),
      parentSourceId: cleanText(pairs.get("父需求ID") || ""),
      description,
      detail,
      testSpec: cleanText(pairs.get("测试规程") || ""),
      text: "",
      judged: true,
      accepted: true,
      reason: "需求表结构直接解析",
    });
  };

  doc.blocks.forEach((block, order) => {
    if (block.kind === "paragraph") {
      if (block.headingLevel > 0) {
        while (headingStack.length && headingStack[headingStack.length - 1].level >= block.headingLevel) {
          headingStack.pop();
        }
        levelCounters[block.headingLevel] = (levelCounters[block.headingLevel] ?? 0) + 1;
        for (let deeper = block.headingLevel + 1; deeper < levelCounters.length; deeper++) {
          levelCounters[deeper] = 0;
        }
        const number = levelCounters
          .slice(1, block.headingLevel + 1)
          .map((value) => value || 1)
          .join(".");
        headingStack.push({ level: block.headingLevel, title: block.text, number });
        currentSection = {
          path: chapterPathOf(),
          level: block.headingLevel,
          paragraphs: [],
          hasRequirementTable: false,
          hasTable: false,
        };
        sections.push(currentSection);
        return;
      }
      if (currentSection && !block.isToc) {
        currentSection.paragraphs.push({ paragraph: block, order });
      }
      return;
    }

    if (currentSection) {
      currentSection.hasTable = true;
      if (isRequirementTable(block)) currentSection.hasRequirementTable = true;
    }
    pushTablePoint(block, order);
  });

  // Only leaf sections are considered for standalone text requirements. A parent
  // section usually contains introductions/figure captions rather than requirements.
  for (const section of sections) {
    if (section.hasRequirementTable) continue;
    const isLeaf = !sections.some(
      (other) =>
        other !== section &&
        other.path.length > section.path.length &&
        section.path.every((title, index) => other.path[index] === title),
    );
    if (!isLeaf) continue;

    for (const { paragraph, order } of section.paragraphs) {
      if (!isTextCandidateParagraph(paragraph)) continue;
      const text = cleanText(paragraph.text);
      if (seenTexts.has(text)) continue;
      seenTexts.add(text);
      textCandidates++;
      const { sourceId, body } = splitTextLabel(text);
      points.push({
        id: "",
        order,
        kind: "text",
        origin: "llm",
        confidence: 0,
        chapter: section.path.join(" / "),
        chapterPath: section.path,
        location: { page: paragraph.page, line: paragraph.line },
        sourceId,
        parentSourceId: "",
        description: "",
        detail: "",
        testSpec: "",
        text: body,
        judged: false,
        accepted: false,
        reason: "",
      });
    }
  }

  points.sort((a, b) => a.order - b.order);
  const normalized: RequirementPoint[] = points.map(({ order: _order, ...point }, index) => ({
    ...point,
    id: `rp-${String(index + 1).padStart(4, "0")}`,
  }));

  if (malformedTables > 0) warnings.push(`${malformedTables} 个需求表缺少描述与说明，已跳过。`);
  if (tablePoints === 0 && textCandidates === 0) {
    warnings.push("未识别到任何需求点：没有找到需求表，也没有可判定的文本章节。");
  }

  const headings = doc.paragraphs
    .filter((paragraph) => paragraph.headingLevel > 0 && !paragraph.isToc)
    .map((paragraph) => ({ level: paragraph.headingLevel, title: paragraph.text, page: paragraph.page }));

  return {
    points: normalized,
    outline: buildOutline(headings),
    stats: buildStats(doc, []),
    warnings,
  };
}

function fallbackType(): RequirementType {
  return "其他需求";
}

/** Deterministic fallback when the LLM is unavailable: only table points become units. */
export function buildFallbackUnits(points: RequirementPoint[]): RequirementUnit[] {
  const units = points
    .filter((point) => point.judged && point.accepted)
    .map((point) => requirementUnitFromPoint(point, {}, "rule"));
  return assignRequirementCodes(units);
}

/**
 * 把需求点转换为需求单元。
 *
 * 保留原文、位置和来源；子系统由外部统一映射提供。
 */
export function requirementUnitFromPoint(
  point: RequirementPoint,
  fields: {
    title?: string;
    type?: RequirementType;
    subsystem?: string;
    summary?: string;
    obligations?: string[];
    keywords?: string[];
  },
  structureOrigin: "rule" | "llm",
): RequirementUnit {
  const sourceText = point.description || point.detail || point.text;
  const detail = point.detail;
  const title = cleanText(fields.title || "").slice(0, 120) || previewTitle(sourceText);
  const type = fields.type ?? fallbackType();
  const subsystem = cleanText(fields.subsystem || "").slice(0, 80) || "全局";
  const obligations = fields.obligations?.length ? fields.obligations.slice(0, 12) : pointObligations(point.description, point.detail || point.text);
  return {
    code: "",
    pointId: point.id,
    sourceKind: point.kind,
    structureOrigin,
    sourceId: point.sourceId,
    parentSourceId: point.parentSourceId,
    type,
    subsystem,
    title,
    description: point.description || point.detail || point.text,
    detail,
    testSpec: point.testSpec,
    chapter: point.chapter,
    chapterPath: point.chapterPath,
    location: point.location,
    confidence: point.confidence,
    origin: point.origin,
    summary: cleanText(fields.summary || "").slice(0, 200) || firstSentences(detail || sourceText, 120),
    obligations,
    keywords: fields.keywords?.length ? fields.keywords.slice(0, 20) : extractKeywords(`${sourceText} ${detail}`, 16),
    reviewStatus: "pending",
    reviewNote: "",
  };
}

export function assignRequirementCodes(units: RequirementUnit[]): RequirementUnit[] {
  const counters = new Map<RequirementType, number>();
  for (const unit of units) {
    const seq = (counters.get(unit.type) ?? 0) + 1;
    counters.set(unit.type, seq);
    unit.code = `SRS-${REQUIREMENT_TYPE_PREFIX[unit.type] ?? "OTH"}-${String(seq).padStart(3, "0")}`;
  }
  return units;
}

/**
 * Synchronous fallback parser used when no LLM is configured, and by CLI tools.
 * Full extraction still returns requirementPoints so the LLM pipeline can run later.
 */
export function parseRequirements(doc: DocxDocument): ParsedRequirements {
  const extraction = extractRequirementPoints(doc);
  const requirements = buildFallbackUnits(extraction.points);
  const warnings = [...doc.warnings, ...extraction.warnings];
  const textCandidates = extraction.points.filter((point) => point.kind === "text").length;
  if (textCandidates > 0) {
    warnings.push(
      `检测到 ${textCandidates} 个文本型候选需求点，尚未由 LLM 判定；配置 LLM 后点击「LLM 整理」或重新上传即可生成需求单元。`,
    );
  }
  return {
    kind: "srs",
    pageCount: doc.pageCount,
    requirements,
    requirementPoints: extraction.points,
    outline: extraction.outline,
    stats: buildStats(doc, requirements),
    warnings,
  };
}

