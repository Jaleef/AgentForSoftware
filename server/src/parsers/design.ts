import type {
  DbField,
  DesignUnit,
  DesignUnitType,
  DocumentStats,
  ParsedDesign,
  SourceLocation,
} from "../types.js";
import type { DocxBlock, DocxDocument, DocxTable } from "./docx.js";
import { expandedRow, tablePairs } from "./docx.js";
import { cleanText, extractKeywords, firstSentences, splitSentences } from "../util/text.js";
import { buildOutline, normalizeSubsystem, subsystemFromText } from "./outline.js";

interface HeadingState {
  level: number;
  title: string;
}

interface PageDraft {
  title: string;
  description: string;
  headingPath: string[];
  page: number;
  line: number;
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
  const first = table.rows[0] ? expandedRow(table.rows[0]).texts.map((t) => t.trim()) : [];
  return first.includes("字段名称") && (first.includes("字段类型") || first.includes("字段含义"));
}

function cleanHeadingName(title: string): string {
  return title
    .replace(/[（(]\d+[）)]\s*$/, "")
    .replace(/模块设计$/, "")
    .replace(/功能设计$/, "")
    .trim();
}

function detectSubsystem(headingPath: string[], fallbackText = ""): string {
  for (let i = headingPath.length - 1; i >= 0; i--) {
    const s = subsystemFromText(headingPath[i]);
    if (s) return s;
  }
  return normalizeSubsystem(fallbackText);
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
  const header = expandedRow(table.rows[0]).texts.map((t) => t.trim());
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

function isPageCandidate(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/分级图|跳转图|模块划分|功能划分|结构图/.test(t)) return false;
  if (/^(人机交互接口|外部系统接口|内部接口|数据接口|服务接口)$/.test(t)) return false;
  if (/^(用户页面|管理员页面)(设计)?$/.test(t)) return false;
  if (/^(用户|管理员)页面设计$/.test(t)) return false;
  return true;
}

function pageName(title: string): string {
  return title
    .replace(/页面设计$/, "页面")
    .replace(/界面设计$/, "界面")
    .replace(/页面$/, "页面")
    .trim();
}

export function parseDesign(doc: DocxDocument): ParsedDesign {
  const warnings: string[] = [];
  const units: DesignUnit[] = [];
  const headings: HeadingState[] = [];
  const headingPath: string[] = [];
  const headingRefs: Array<{ level: number; title: string; page: number }> = [];
  const counters = new Map<DesignUnitType, number>();
  const byChapter: Record<string, number> = {};
  const seen = new Set<string>();
  let lastParagraph = "";
  let currentH1 = "";
  let pageDraft: PageDraft | null = null;
  const pageDrafts: PageDraft[] = [];

  const finalizePage = (): void => {
    if (!pageDraft) return;
    pageDrafts.push(pageDraft);
    pageDraft = null;
  };

  const nextCode = (type: DesignUnitType): string => {
    const seq = (counters.get(type) ?? 0) + 1;
    counters.set(type, seq);
    const prefix = type === "子功能" ? "FUN" : type === "模块" ? "MOD" : type === "数据表" ? "DB" : "PAGE";
    return `SDD-${prefix}-${String(seq).padStart(3, "0")}`;
  };

  const pushUnit = (unit: DesignUnit): void => {
    if (seen.has(unit.code)) return;
    seen.add(unit.code);
    units.push(unit);
    byChapter[unit.chapter.split(" / ").slice(2, 3).join("") || unit.chapter.split(" / ")[1] || "未分类"] =
      (byChapter[unit.chapter.split(" / ").slice(2, 3).join("") || unit.chapter.split(" / ")[1] || "未分类"] ?? 0) + 1;
  };

  const addTableUnit = (table: DocxTable): void => {
    const pairs = pairMap(table);
    const subfunctionId = cleanText(pairs.get("子功能编号") || "");
    const moduleId = cleanText(pairs.get("模块编号") || "");
    const name = cleanText(pairs.get("功能名称") || pairs.get("模块名称") || "");
    const description = cleanText(pairs.get("功能描述") || "");
    if (!name && !description) return;
    const type: DesignUnitType = subfunctionId ? "子功能" : "模块";
    const chapter = headingPath.join(" / ") || "未分类";
    const subsystem = detectSubsystem(headingPath, `${name} ${description}`);
    const interfaceText = cleanText(pairs.get("接口") || "");
    const input = cleanText(pairs.get("输入") || "");
    const output = cleanText(pairs.get("输出") || "");
    const fallbackName = cleanHeadingName(headings[headings.length - 1]?.title ?? "");
    const finalName = name || fallbackName || "未命名设计单元";
    const confidence = description && name ? 0.95 : 0.78;
    const location: SourceLocation = { page: table.page, line: table.line };
    pushUnit({
      code: nextCode(type),
      sourceId: subfunctionId || moduleId,
      parentSourceId: subfunctionId ? moduleId : "",
      type,
      subsystem,
      name: finalName,
      description: description || finalName,
      detail: "",
      interfaceText,
      input,
      output,
      chapter,
      location,
      confidence,
      origin: "rule",
      summary: firstSentences(description || finalName, 140),
      obligations: unitObligations(description, interfaceText, input, output),
      keywords: extractKeywords(`${finalName} ${description} ${interfaceText} ${input} ${output}`, 18),
      fields: [],
      reviewStatus: "pending",
      reviewNote: "",
    });
  };

  const addDbUnit = (table: DocxTable, tableName: string): void => {
    const fields = parseDbFields(table);
    if (!fields.length) return;
    const chapter = headingPath.join(" / ") || "未分类";
    const subsystem = detectSubsystem(headingPath, tableName);
    const fieldSummary = `字段：${fields.slice(0, 12).map((f) => `${f.name}(${f.meaning || f.type})`).join("、")}${
      fields.length > 12 ? "…" : ""
    }`;
    const name = tableName || `数据表 ${units.filter((u) => u.type === "数据表").length + 1}`;
    const description = `${name}，共 ${fields.length} 个字段。${fieldSummary}`;
    pushUnit({
      code: nextCode("数据表"),
      sourceId: name,
      parentSourceId: subsystem,
      type: "数据表",
      subsystem,
      name,
      description,
      detail: fields.map((f) => `${f.name}｜${f.meaning}｜${f.type}${f.length ? `(${f.length})` : ""}${f.primaryKey ? "｜主键" : ""}`).join("\n"),
      interfaceText: "",
      input: "",
      output: "",
      chapter,
      location: { page: table.page, line: table.line },
      confidence: 0.9,
      origin: "rule",
      summary: firstSentences(description, 160),
      obligations: fields
        .filter((f) => f.primaryKey)
        .map((f) => `主键字段 ${f.name} 必须唯一且非空`)
        .concat(fields.slice(0, 3).map((f) => `存储字段 ${f.name}（${f.meaning || f.type}）`))
        .slice(0, 8),
      keywords: extractKeywords(`${name} ${fields.map((f) => `${f.name} ${f.meaning}`).join(" ")}`, 18),
      fields,
      reviewStatus: "pending",
      reviewNote: "",
    });
  };

  doc.blocks.forEach((block: DocxBlock) => {
    if (block.kind === "paragraph") {
      if (block.isToc) return;
      if (block.headingLevel > 0) {
        finalizePage();
        while (headings.length && headings[headings.length - 1].level >= block.headingLevel) headings.pop();
        headings.push({ level: block.headingLevel, title: block.text });
        headingPath.length = 0;
        headingPath.push(...headings.map((h) => h.title));
        headingRefs.push({ level: block.headingLevel, title: block.text, page: block.page });
        if (block.headingLevel === 1) currentH1 = block.text;
        lastParagraph = "";
        if (currentH1.includes("页面设计") && block.headingLevel >= 3 && block.headingLevel <= 5) {
          const title = block.text.trim();
          if (isPageCandidate(title)) {
            pageDraft = {
              title: pageName(title),
              description: "",
              headingPath: [...headingPath],
              page: block.page,
              line: block.line,
            };
          }
        }
        return;
      }
      if (block.text) {
        lastParagraph = block.text;
        if (pageDraft) {
          pageDraft.description = cleanText(`${pageDraft.description}\n${block.text}`).slice(0, 1600);
        }
      }
      return;
    }

    const table = block;
    if (isDbTable(table)) {
      const preceding = lastParagraph.trim();
      const tableName = preceding && preceding.length < 40 && /表$/.test(preceding) ? preceding : cleanHeadingName(headingPath[headingPath.length - 1] ?? "");
      addDbUnit(table, tableName);
      lastParagraph = "";
      return;
    }
    if (isDesignUnitTable(table)) {
      addTableUnit(table);
      lastParagraph = "";
      return;
    }
    if (pageDraft) {
      // Tables inside a page section often enumerate UI elements; keep a short trace.
      const rows = table.rows.slice(0, 4).map((r) => expandedRow(r).texts.filter(Boolean).join(" "));
      pageDraft.description = cleanText(`${pageDraft.description}\n${rows.join("；")}`).slice(0, 1600);
    }
  });
  finalizePage();

  for (const draft of pageDrafts) {
    const subsystem = detectSubsystem(draft.headingPath, draft.title);
    const chapter = draft.headingPath.join(" / ") || "未分类";
    const description =
      draft.description ||
      `${draft.title}，位于「${chapter}」。页面设计未给出更详细的文字说明，需结合原型图与页面跳转图确认。`;
    pushUnit({
      code: nextCode("页面"),
      sourceId: draft.title,
      parentSourceId: subsystem,
      type: "页面",
      subsystem,
      name: draft.title,
      description,
      detail: "",
      interfaceText: "",
      input: "",
      output: "",
      chapter,
      location: { page: draft.page, line: draft.line },
      confidence: draft.description ? 0.82 : 0.65,
      origin: "rule",
      summary: firstSentences(description, 160),
      obligations: splitSentences(description)
        .map((s) => s.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
        .filter((s) => s.length >= 6)
        .slice(0, 8),
      keywords: extractKeywords(`${draft.title} ${description}`, 16),
      fields: [],
      reviewStatus: "pending",
      reviewNote: "",
    });
  }

  if (units.filter((u) => u.type === "子功能" || u.type === "模块").length === 0) {
    warnings.push("未识别到模块/子功能设计单元。请确认文档使用「模块编号 / 子功能编号 / 功能名称 / 功能描述 / 接口 / 输入 / 输出」设计表。");
  }
  if (units.filter((u) => u.type === "数据表").length === 0) warnings.push("未识别到数据库表设计，设计→代码的数据层覆盖将不完整。");

  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  for (const u of units) {
    byType[u.type] = (byType[u.type] ?? 0) + 1;
    bySubsystem[u.subsystem] = (bySubsystem[u.subsystem] ?? 0) + 1;
  }
  const stats: DocumentStats = {
    total: units.length,
    byType,
    bySubsystem,
    byChapter,
    pages: doc.pageCount,
    tables: doc.tables.length,
    paragraphs: doc.paragraphs.length,
  };

  return {
    kind: "sdd",
    pageCount: doc.pageCount,
    designUnits: units,
    outline: buildOutline(headingRefs),
    stats,
    warnings: [...doc.warnings, ...warnings],
  };
}
