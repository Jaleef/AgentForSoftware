import type {
  DocumentStats,
  ParsedRequirements,
  RequirementType,
  RequirementUnit,
  SourceLocation,
} from "../types.js";
import type { DocxDocument, DocxTable } from "./docx.js";
import { tablePairs } from "./docx.js";
import { firstSentences, cleanText, extractKeywords, splitSentences } from "../util/text.js";
import { buildOutline, normalizeSubsystem, subsystemFromText } from "./outline.js";

const TYPE_PREFIX: Record<RequirementType, string> = {
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

interface HeadingState {
  level: number;
  title: string;
}

export function isRequirementTable(table: DocxTable): boolean {
  const pairs = tablePairs(table);
  const labels = new Set(pairs.map((p) => p.label));
  return (labels.has("需求描述") || labels.has("需求名称")) && (labels.has("需求说明") || labels.has("测试规程") || labels.has("需求ID"));
}

export function classifyRequirementType(headingPath: string[], description: string): RequirementType {
  const h2 = headingPath[1] ?? "";
  const h3 = headingPath[2] ?? "";
  const all = `${headingPath.join(" ")} ${description}`;
  if (h2.includes("用例")) return "用例需求";
  if (h2.includes("功能需求")) return "功能需求";
  if (h2.includes("性能需求")) return "性能需求";
  if (h2.includes("外部接口")) {
    if (h3.includes("人机交互") || /界面|页面|UI\s*[0-9]/i.test(all)) return "页面/人机交互需求";
    return "接口需求";
  }
  if (h2.includes("内部接口")) return "接口需求";
  if (h2.includes("数据需求")) return /元数据/.test(all) ? "元数据需求" : "数据需求";
  if (h2.includes("环境要求")) return "环境需求";
  if (h2.includes("安全") || h2.includes("保密")) return "安全保密需求";
  if (h2.includes("约束")) return "设计实现约束";
  if (h2.includes("验收") || h2.includes("交付")) return "验收交付需求";
  if (h2.includes("其它需求") || h2.includes("其他需求")) return "质量属性需求";
  if (/界面|页面/.test(description)) return "页面/人机交互需求";
  return "其他需求";
}

function detectSubsystem(headingPath: string[], text: string): string {
  for (let i = headingPath.length - 1; i >= 0; i--) {
    const s = subsystemFromText(headingPath[i]);
    if (s) return s;
  }
  return normalizeSubsystem(text);
}

function chapterKey(headingPath: string[]): string {
  return headingPath.slice(1, 2).join("") || headingPath[0] || "未分类";
}

function shouldExtractParagraph(
  h2: string,
  h3: string,
  text: string,
): RequirementType | null {
  const t = text.trim();
  if (!t) return null;
  if (t.length < 6) return null;
  if (/[：:]$/.test(t) && t.length < 24) return null;
  if (/^[0-9]+[）)]\s*\S{1,10}$/.test(t)) return null;
  if (/^(如图|见表|如下表|上图|下图)/.test(t)) return null;
  if (/图\s*3-\d+|表\s*3-\d+/.test(t) && t.length < 80) return null;
  if (/^(注|说明)[：:]/.test(t) && t.length < 30) return null;

  if (h2.includes("内部接口")) return "接口需求";
  if (h2.includes("外部接口")) {
    if (h3.includes("外部系统接口") || h3.includes("虚实映射接口") || h3.includes("软件接口")) {
      return "接口需求";
    }
    return null;
  }
  if (h2.includes("数据需求")) return "数据需求";
  if (h2.includes("环境要求")) return "环境需求";
  if (h2.includes("安全") && /^SAF[-_]?\d+/i.test(t)) return "安全保密需求";
  if (h2.includes("约束") && /^CO[-_]?\d+/i.test(t)) return "设计实现约束";
  if (h2.includes("验收") || h2.includes("交付")) return "验收交付需求";
  if (h2.includes("其它需求") || h2.includes("其他需求")) {
    if (h3.includes("质量属性") && !/由.{0,20}组成/.test(t)) return "质量属性需求";
    if (h3.includes("元数据")) return "元数据需求";
    return null;
  }
  return null;
}

function stripRequirementLabel(text: string): { sourceId: string; body: string } {
  const m = text.match(/^((?:SAF|CO|ENV|DEL|QA|META|IF|DATA)[-_]?\s*\d+)\s*[:：]\s*(.*)$/i);
  if (m) return { sourceId: m[1].replace(/\s+/g, ""), body: m[2].trim() || text };
  return { sourceId: "", body: text };
}

function pairMap(table: DocxTable): Map<string, string> {
  const map = new Map<string, string>();
  for (const { label, value } of tablePairs(table)) {
    if (!LABELS.has(label)) continue;
    if (!map.has(label)) map.set(label, value);
  }
  return map;
}

export function parseRequirements(doc: DocxDocument): ParsedRequirements {
  const warnings: string[] = [];
  const requirements: RequirementUnit[] = [];
  const counters = new Map<RequirementType, number>();
  const seen = new Set<string>();
  const headings: HeadingState[] = [];
  const headingRefs: Array<{ level: number; title: string; page: number }> = [];
  const byChapter: Record<string, number> = {};
  let headingPath: string[] = [];
  let malformed = 0;

  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      if (block.isToc) continue;
      if (block.headingLevel > 0) {
        while (headings.length && headings[headings.length - 1].level >= block.headingLevel) headings.pop();
        headings.push({ level: block.headingLevel, title: block.text });
        headingPath = headings.map((h) => h.title);
        headingRefs.push({ level: block.headingLevel, title: block.text, page: block.page });
        continue;
      }
      if (block.styleName.includes("图标题") || block.styleName.toLowerCase().includes("caption")) continue;
      if (!block.text) continue;
      const h2 = headingPath[1] ?? "";
      const h3 = headingPath[2] ?? "";
      const paragraphType = shouldExtractParagraph(h2, h3, block.text);
      if (!paragraphType) continue;
      const { sourceId, body } = stripRequirementLabel(block.text);
      const text = cleanText(body);
      if (!seen.has(text)) {
        const subsystem = detectSubsystem(headingPath, text);
        const chapter = headingPath.join(" / ") || "未分类";
        const seq = (counters.get(paragraphType) ?? 0) + 1;
        counters.set(paragraphType, seq);
        const code = `SRS-${TYPE_PREFIX[paragraphType]}-${String(seq).padStart(3, "0")}`;
        const title = firstSentences(text, 64);
        byChapter[chapterKey(headingPath)] = (byChapter[chapterKey(headingPath)] ?? 0) + 1;
        seen.add(text);
        requirements.push({
          code,
          sourceId,
          parentSourceId: "",
          type: paragraphType,
          subsystem,
          title,
          description: text,
          detail: "",
          testSpec: "",
          chapter,
          location: { page: block.page, line: block.line },
          confidence: sourceId ? 0.82 : 0.72,
          origin: "rule",
          summary: firstSentences(text, 120),
          obligations: splitSentences(text)
            .map((s) => s.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
            .filter((s) => s.length >= 6)
            .slice(0, 8),
          keywords: extractKeywords(text, 16),
          reviewStatus: "pending",
          reviewNote: "",
        });
      }
      continue;
    }

    if (!isRequirementTable(block)) continue;
    const pairs = pairMap(block);
    const description = cleanText(pairs.get("需求描述") || pairs.get("需求名称") || "");
    const detail = cleanText(pairs.get("需求说明") || "");
    if (!description && !detail) {
      malformed++;
      continue;
    }
    const sourceId = cleanText(pairs.get("需求ID") || "");
    const parentSourceId = cleanText(pairs.get("父需求ID") || "");
    const testSpec = cleanText(pairs.get("测试规程") || "");
    const type = classifyRequirementType(headingPath, `${description} ${detail}`);
    const subsystem = detectSubsystem(headingPath, `${description} ${detail}`);
    const chapter = headingPath.join(" / ") || "未分类";
    const key = `${description}::${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const seq = (counters.get(type) ?? 0) + 1;
    counters.set(type, seq);
    const code = `SRS-${TYPE_PREFIX[type]}-${String(seq).padStart(3, "0")}`;
    const location: SourceLocation = { page: block.page, line: block.line };
    const title = description ? firstSentences(description, 64) : firstSentences(detail, 64);
    const obligations = splitSentences(`${description}。${detail}`)
      .map((s) => s.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
      .filter((s) => s.length >= 6)
      .slice(0, 8);
    const completeness = (description ? 1 : 0) + (detail ? 1 : 0);
    const confidence = completeness === 2 ? 0.96 : completeness === 1 ? 0.78 : 0.6;

    byChapter[chapterKey(headingPath)] = (byChapter[chapterKey(headingPath)] ?? 0) + 1;

    requirements.push({
      code,
      sourceId,
      parentSourceId,
      type,
      subsystem,
      title,
      description: description || detail,
      detail,
      testSpec,
      chapter,
      location,
      confidence,
      origin: "rule",
      summary: firstSentences(detail || description, 120),
      obligations,
      keywords: extractKeywords(`${description} ${detail}`, 16),
      reviewStatus: "pending",
      reviewNote: "",
    });
  }

  if (malformed > 0) warnings.push(`${malformed} 个需求表格缺少需求描述与需求说明，已跳过。`);
  if (requirements.length === 0) {
    warnings.push("未识别到需求单元。请确认文档使用「需求ID / 需求描述 / 需求说明 / 测试规程」表格描述需求。");
  }

  const byType: Record<string, number> = {};
  const bySubsystem: Record<string, number> = {};
  for (const r of requirements) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    bySubsystem[r.subsystem] = (bySubsystem[r.subsystem] ?? 0) + 1;
  }

  const stats: DocumentStats = {
    total: requirements.length,
    byType,
    bySubsystem,
    byChapter,
    pages: doc.pageCount,
    tables: doc.tables.length,
    paragraphs: doc.paragraphs.length,
  };

  return {
    kind: "srs",
    pageCount: doc.pageCount,
    requirements,
    outline: buildOutline(headingRefs),
    stats,
    warnings: [...doc.warnings, ...warnings],
  };
}
