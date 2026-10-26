import type {
  DbField,
  DesignPoint,
  DesignUnit,
  DesignUnitType,
  DocumentStats,
  ParsedDesign,
  SourceLocation,
} from "../types.js";
import type { DocxBlock, DocxDocument, DocxTable } from "./docx.js";
import { expandedRow, tablePairs } from "./docx.js";
import { cleanText, extractKeywords, firstSentences, splitSentences } from "../util/text.js";
import { buildOutline } from "./outline.js";

interface HeadingState {
  level: number;
  title: string;
  number: string;
}

interface SectionParagraph {
  text: string;
  page: number;
  line: number;
  order: number;
}

interface DesignSection {
  path: string[];
  level: number;
  order: number;
  page: number;
  line: number;
  paragraphs: SectionParagraph[];
  tableTexts: string[];
  hasStructuredTable: boolean;
  hasDbTable: boolean;
  pageLike: boolean;
}

const FIELD_ALIASES: Record<keyof DbField, string[]> = {
  name: ["字段名称", "字段名", "名称"],
  meaning: ["字段含义", "含义", "说明"],
  type: ["字段类型", "类型"],
  length: ["字段长度", "长度"],
  primaryKey: ["是否主键", "主键"],
  defaultValue: ["默认值"],
};

function pairMap(table: DocxTable): Map<string, string> {
  const map = new Map<string, string>();
  for (const { label, value } of tablePairs(table)) {
    if (!map.has(label)) map.set(label, value);
  }
  return map;
}

export function isDesignUnitTable(table: DocxTable): boolean {
  const labels = new Set(tablePairs(table).map((p) => p.label));
  return (
    labels.has("子功能编号") ||
    (labels.has("模块编号") && (labels.has("功能描述") || labels.has("模块名称") || labels.has("功能名称")))
  );
}

export function isDbTable(table: DocxTable): boolean {
  const first = table.rows[0] ? expandedRow(table.rows[0]).texts.map((t) => t.trim().replace(/\s+/g, "")) : [];
  return first.includes("字段名称") && (first.includes("字段类型") || first.includes("字段含义"));
}

function cleanHeadingName(title: string): string {
  return title
    .replace(/[（(]\d+[）)]\s*$/, "")
    .replace(/模块设计$/, "")
    .replace(/功能设计$/, "")
    .trim();
}

function unitObligations(description: string, interfaceText: string, input: string, output: string): string[] {
  const base = splitSentences(description)
    .map((s) => s.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
    .filter((s) => s.length >= 6);
  if (interfaceText.trim()) {
    const calls = interfaceText
      .split(/\s*\/\s*|\n/)
      .map((s) => s.trim())
      .filter((s) => /[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(s));
    if (calls.length) base.push(`提供接口：${calls.slice(0, 4).join("；")}`);
  }
  if (input.trim()) base.push(`接收输入：${firstSentences(input, 80)}`);
  if (output.trim()) base.push(`产出结果：${firstSentences(output, 80)}`);
  return base.slice(0, 10);
}

function parseDbFields(table: DocxTable): DbField[] {
  if (!table.rows.length) return [];
  const header = expandedRow(table.rows[0]).texts.map((t) => t.trim().replace(/\s+/g, ""));
  const idx = (key: keyof DbField): number => {
    const aliases = FIELD_ALIASES[key];
    return header.findIndex((h) => aliases.includes(h));
  };
  const indexes = {
    name: idx("name"),
    meaning: idx("meaning"),
    type: idx("type"),
    length: idx("length"),
    primaryKey: idx("primaryKey"),
    defaultValue: idx("defaultValue"),
  };
  const fields: DbField[] = [];
  for (const row of table.rows.slice(1)) {
    const cells = expandedRow(row).texts;
    const name = (cells[indexes.name] ?? "").trim();
    if (!name || name === "字段名称") continue;
    fields.push({
      name,
      meaning: (cells[indexes.meaning] ?? "").trim(),
      type: (cells[indexes.type] ?? "").trim(),
      length: (cells[indexes.length] ?? "").trim(),
      primaryKey: /^(√|是|yes|y|1)$/i.test((cells[indexes.primaryKey] ?? "").trim()),
      defaultValue: (cells[indexes.defaultValue] ?? "").trim(),
    });
  }
  return fields;
}

function pageName(title: string): string {
  return title.replace(/页面设计$/, "页面").replace(/界面设计$/, "界面").trim();
}

function isDesignTextCandidate(text: string): boolean {
  const value = cleanText(text);
  if (!value || value.length < 8) return false;
  if (/^(图|表)\s*\d/.test(value)) return false;
  if (/^(如图|见表|如下表|上图|下图)/.test(value)) return false;
  if (value.length < 80 && /(示意图|流程图|结构图|用例图|逻辑图|跳转图|划分图|图)$/.test(value)) return false;
  if (/[：:]$/.test(value) && value.length < 24) return false;
  return true;
}

function dbFieldSummary(fields: DbField[]): string {
  return `字段：${fields
    .slice(0, 12)
    .map((field) => `${field.name}(${field.meaning || field.type})`)
    .join("、")}${fields.length > 12 ? "…" : ""}`;
}

/**
 * Stage 1 of the design pipeline:
 * - structured design table -> trusted design point (rule / 100%)
 * - database table -> candidate point for LLM judgement
 * - text-only leaf section -> candidate point for LLM judgement
 */
export function extractDesignPoints(doc: DocxDocument): { points: DesignPoint[]; warnings: string[] } {
  const warnings: string[] = [];
  const points: Array<DesignPoint & { order: number }> = [];
  const sections: DesignSection[] = [];
  const headingStack: HeadingState[] = [];
  const counters: number[] = [];
  const seenTables = new Set<string>();
  const seenTexts = new Set<string>();
  let lastParagraph = "";
  let currentSection: DesignSection | null = null;
  let structuredTables = 0;
  let databaseTables = 0;
  let textCandidates = 0;

  const chapterPathOf = (): string[] => headingStack.map((heading) => `${heading.number} ${heading.title}`);
  const chapterOf = (): string => {
    const path = chapterPathOf();
    return path.length ? path.join(" / ") : "未分类";
  };
  const headingTitle = (): string => headingStack[headingStack.length - 1]?.title ?? "";

  const pushTablePoint = (table: DocxTable, order: number): void => {
    const pairs = pairMap(table);
    const subfunctionId = cleanText(pairs.get("子功能编号") || "");
    const moduleId = cleanText(pairs.get("模块编号") || "");
    const name = cleanText(pairs.get("功能名称") || pairs.get("模块名称") || "");
    const description = cleanText(pairs.get("功能描述") || "");
    if (!name && !description) return;
    const fallbackName = cleanHeadingName(headingTitle());
    const finalName = name || fallbackName || "未命名设计单元";
    const key = `${subfunctionId}::${moduleId}::${finalName}::${description}`;
    if (seenTables.has(key)) return;
    seenTables.add(key);
    structuredTables++;
    const typeHint: DesignUnitType = subfunctionId ? "子功能" : "模块";
    points.push({
      id: "",
      order,
      kind: "table",
      origin: "rule",
      confidence: 1,
      typeHint,
      chapter: chapterOf(),
      chapterPath: chapterPathOf(),
      location: { page: table.page, line: table.line },
      sourceId: subfunctionId || moduleId,
      parentSourceId: subfunctionId ? moduleId : "",
      name: finalName,
      description: description || finalName,
      detail: "",
      interfaceText: cleanText(pairs.get("接口") || ""),
      input: cleanText(pairs.get("输入") || ""),
      output: cleanText(pairs.get("输出") || ""),
      fields: [],
      text: "",
      judged: true,
      accepted: true,
      reason: "设计表结构直接解析",
    });
  };

  const pushDbPoint = (table: DocxTable, order: number): void => {
    const fields = parseDbFields(table);
    if (!fields.length) return;
    const preceding = cleanText(lastParagraph).trim();
    const name =
      preceding && preceding.length < 40 && /表$/.test(preceding)
        ? preceding
        : cleanHeadingName(headingTitle()) || "数据表";
    const key = `${name}::${fields.map((field) => field.name).join(",")}`;
    if (seenTables.has(key)) return;
    seenTables.add(key);
    databaseTables++;
    const description = `${name}，共 ${fields.length} 个字段。${dbFieldSummary(fields)}`;
    points.push({
      id: "",
      order,
      kind: "database",
      origin: "llm",
      confidence: 0,
      typeHint: "数据表",
      chapter: chapterOf(),
      chapterPath: chapterPathOf(),
      location: { page: table.page, line: table.line },
      sourceId: name,
      parentSourceId: "",
      name,
      description,
      detail: fields
        .map(
          (field) =>
            `${field.name}｜${field.meaning}｜${field.type}${field.length ? `(${field.length})` : ""}${
              field.primaryKey ? "｜主键" : ""
            }`,
        )
        .join("\n"),
      interfaceText: "",
      input: "",
      output: "",
      fields,
      text: "",
      judged: false,
      accepted: false,
      reason: "",
    });
  };

  doc.blocks.forEach((block: DocxBlock, order) => {
    if (block.kind === "paragraph") {
      if (block.isToc) return;
      if (block.headingLevel > 0) {
        while (headingStack.length && headingStack[headingStack.length - 1].level >= block.headingLevel) {
          headingStack.pop();
        }
        counters[block.headingLevel] = (counters[block.headingLevel] ?? 0) + 1;
        for (let deeper = block.headingLevel + 1; deeper < counters.length; deeper++) counters[deeper] = 0;
        const number = counters
          .slice(1, block.headingLevel + 1)
          .map((value) => value || 1)
          .join(".");
        headingStack.push({ level: block.headingLevel, title: block.text, number });
        const path = chapterPathOf();
        currentSection = {
          path,
          level: block.headingLevel,
          order,
          page: block.page,
          line: block.line,
          paragraphs: [],
          tableTexts: [],
          hasStructuredTable: false,
          hasDbTable: false,
          pageLike: path.some((segment) => segment.includes("页面设计")),
        };
        sections.push(currentSection);
        lastParagraph = "";
        return;
      }
      if (currentSection && block.text) {
        currentSection.paragraphs.push({
          text: block.text,
          page: block.page,
          line: block.line,
          order,
        });
      }
      if (block.text) lastParagraph = block.text;
      return;
    }

    if (isDesignUnitTable(block)) {
      pushTablePoint(block, order);
      if (currentSection) currentSection.hasStructuredTable = true;
      lastParagraph = "";
      return;
    }
    if (isDbTable(block)) {
      pushDbPoint(block, order);
      if (currentSection) currentSection.hasDbTable = true;
      lastParagraph = "";
      return;
    }
    if (currentSection) {
      const rows = block.rows.slice(0, 8).map((row) => expandedRow(row).texts.filter(Boolean).join(" "));
      if (rows.length) currentSection.tableTexts.push(rows.join("；"));
    }
  });

  // Text-only leaf sections become candidates. A section containing structured
  // design tables or DB tables already has trusted/candidate points, so its
  // surrounding prose is not duplicated as another candidate.
  for (const section of sections) {
    if (section.hasStructuredTable || section.hasDbTable) continue;
    const isLeaf = !sections.some(
      (other) =>
        other !== section &&
        other.path.length > section.path.length &&
        section.path.every((segment, index) => other.path[index] === segment),
    );
    if (!isLeaf) continue;

    const paragraphs = section.paragraphs
      .filter((paragraph) => isDesignTextCandidate(paragraph.text))
      .map((paragraph) => cleanText(paragraph.text));
    const tableText = section.tableTexts.join("；");
    const text = cleanText([...paragraphs, tableText].filter(Boolean).join("\n")).slice(0, 2400);
    if (!text && !section.pageLike) continue;
    const title = pageName(cleanHeadingName(headingStackTitle(section.path)) || "页面");
    const description = text || `页面设计：${title}`;
    if (seenTexts.has(description)) continue;
    seenTexts.add(description);
    textCandidates++;
    const first = section.paragraphs[0];
    points.push({
      id: "",
      order: section.order,
      kind: "text",
      origin: "llm",
      confidence: 0,
      typeHint: section.pageLike ? "页面" : "",
      chapter: section.path.join(" / "),
      chapterPath: section.path,
      location: { page: first?.page ?? section.page, line: first?.line ?? section.line },
      sourceId: "",
      parentSourceId: "",
      name: title,
      description,
      detail: "",
      interfaceText: "",
      input: "",
      output: "",
      fields: [],
      text,
      judged: false,
      accepted: false,
      reason: "",
    });
  }

  points.sort((a, b) => a.order - b.order);
  const normalized: DesignPoint[] = points.map(({ order: _order, ...point }, index) => ({
    ...point,
    id: `dp-${String(index + 1).padStart(4, "0")}`,
  }));

  if (structuredTables === 0 && databaseTables === 0 && textCandidates === 0) {
    warnings.push("未识别到设计表、数据库表或可判定的文本设计章节。");
  } else if (structuredTables === 0) {
    warnings.push("未识别到结构化设计表；文本章节与数据库表将作为候选交由 LLM 判定。");
  }
  if (databaseTables > 0) {
    warnings.push(`检测到 ${databaseTables} 个数据库表候选，尚未由 LLM 判定是否为设计单元。`);
  }
  if (textCandidates > 0) {
    warnings.push(`检测到 ${textCandidates} 个文本设计候选，尚未由 LLM 判定是否为设计单元。`);
  }

  return { points: normalized, warnings };
}

function headingStackTitle(path: string[]): string {
  const last = path[path.length - 1] ?? "";
  return last.replace(/^\d+(?:\.\d+)*\s*/, "");
}

export function designUnitFromPoint(
  point: DesignPoint,
  fields: {
    name?: string;
    type?: DesignUnitType;
    subsystem?: string;
    summary?: string;
    obligations?: string[];
    keywords?: string[];
  },
  structureOrigin: "rule" | "llm",
): DesignUnit {
  const type: DesignUnitType =
    fields.type ??
    (point.kind === "database" ? "数据表" : point.typeHint || "模块");
  const name = fields.name || point.name || "未命名设计单元";
  const description = point.description || point.text || name;
  const obligations =
    fields.obligations && fields.obligations.length
      ? fields.obligations
      : point.kind === "database"
        ? point.fields
            .filter((field) => field.primaryKey)
            .map((field) => `主键字段 ${field.name} 必须唯一且非空`)
            .concat(point.fields.slice(0, 3).map((field) => `存储字段 ${field.name}（${field.meaning || field.type}）`))
            .slice(0, 10)
        : unitObligations(description, point.interfaceText, point.input, point.output);
  return {
    code: "",
    pointId: point.id,
    sourceKind: point.kind,
    structureOrigin,
    sourceId: point.sourceId,
    parentSourceId: point.parentSourceId,
    type,
    subsystem: fields.subsystem || "全局",
    name,
    description,
    detail: point.detail,
    interfaceText: point.interfaceText,
    input: point.input,
    output: point.output,
    chapter: point.chapter,
    chapterPath: point.chapterPath,
    location: point.location,
    confidence: point.confidence,
    origin: point.origin,
    summary: fields.summary || firstSentences(description, 160),
    obligations,
    keywords: fields.keywords || extractKeywords(`${name} ${description} ${point.interfaceText}`, 18),
    fields: point.fields,
    reviewStatus: "pending",
    reviewNote: "",
  };
}

export function assignDesignCodes(units: DesignUnit[]): DesignUnit[] {
  const counters = new Map<DesignUnitType, number>();
  const nextCode = (type: DesignUnitType): string => {
    const seq = (counters.get(type) ?? 0) + 1;
    counters.set(type, seq);
    const prefix = type === "子功能" ? "FUN" : type === "模块" ? "MOD" : type === "数据表" ? "DB" : "PAGE";
    return `SDD-${prefix}-${String(seq).padStart(3, "0")}`;
  };
  return units.map((unit) => ({ ...unit, code: nextCode(unit.type) }));
}

export function buildFallbackDesignUnits(points: DesignPoint[]): DesignUnit[] {
  const accepted = points.filter((point) => point.judged && point.accepted);
  return assignDesignCodes(accepted.map((point) => designUnitFromPoint(point, {}, "rule")));
}

export function buildDesignStats(doc: DocxDocument, units: DesignUnit[]): DocumentStats {
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

export function parseDesign(doc: DocxDocument): ParsedDesign {
  const extraction = extractDesignPoints(doc);
  const units = buildFallbackDesignUnits(extraction.points);
  const headings = doc.paragraphs
    .filter((paragraph) => paragraph.headingLevel > 0 && !paragraph.isToc)
    .map((paragraph) => ({ level: paragraph.headingLevel, title: paragraph.text, page: paragraph.page }));
  return {
    kind: "sdd",
    pageCount: doc.pageCount,
    designUnits: units,
    designPoints: extraction.points,
    outline: buildOutline(headings),
    stats: buildDesignStats(doc, units),
    warnings: [...doc.warnings, ...extraction.warnings],
  };
}
