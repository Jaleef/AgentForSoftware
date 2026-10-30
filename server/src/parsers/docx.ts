/**
 * DOCX/OOXML 正文解析器。
 *
 * 读取段落、标题、表格、合并单元格、分页标记和页码/行号估算。
 */

import { readFileSync } from "node:fs";
import { ZipArchive } from "./zip.js";
import {
  attr,
  child,
  children,
  descendants,
  localName,
  parseXml,
  type XmlNode,
} from "./xml.js";
import { cleanText } from "../util/text.js";

export interface DocxParagraph {
  kind: "paragraph";
  index: number;
  text: string;
  styleId: string;
  styleName: string;
  headingLevel: number;
  isToc: boolean;
  page: number;
  line: number;
  hasImage: boolean;
  breaks: number;
}

export interface DocxCell {
  text: string;
  colSpan: number;
  vMerge: "none" | "restart" | "continue";
  gridColumn: number;
}

export interface DocxRow {
  cells: DocxCell[];
}

export interface DocxTable {
  kind: "table";
  index: number;
  rows: DocxRow[];
  page: number;
  line: number;
}

export type DocxBlock = DocxParagraph | DocxTable;

export interface DocxDocument {
  blocks: DocxBlock[];
  paragraphs: DocxParagraph[];
  tables: DocxTable[];
  pageCount: number;
  styleNames: Map<string, string>;
  warnings: string[];
}

interface StyleInfo {
  name: string;
  type: string;
  basedOn?: string;
}

const LINES_PER_PAGE = 46;

function parseStyles(xml: string | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  const doc = parseXml(xml);
  for (const style of descendants(doc, "style")) {
    const id = attr(style, "styleId");
    if (!id) continue;
    const nameNode = child(style, "name");
    const basedOn = child(style, "basedOn");
    map.set(id, {
      name: attr(nameNode, "val") || id,
      type: attr(style, "type"),
      basedOn: attr(basedOn, "val") || undefined,
    });
  }
  return map;
}

function styleHeadingLevel(style: StyleInfo | undefined, styleId: string, pPr: XmlNode | undefined): number {
  const name = (style?.name ?? styleId ?? "").toLowerCase().trim();
  const m = name.match(/^heading\s*([1-9])$/) || name.match(/^标题\s*([1-9])$/);
  if (m) return Number(m[1]);
  if (name === "title") return 1;
  const outline = pPr ? child(pPr, "outlineLvl") : undefined;
  const lvl = attr(outline, "val");
  if (lvl) return Number(lvl) + 1;
  return 0;
}

function nodeText(node: XmlNode): string {
  let out = "";
  const walk = (n: XmlNode): void => {
    if (n.name === "#text") {
      out += n.text;
      return;
    }
    if (localName(n.name) === "t") {
      out += n.children.filter((c) => c.name === "#text").map((c) => c.text).join("");
      return;
    }
    const ln = localName(n.name);
    if (ln === "tab") {
      out += " ";
      return;
    }
    if (ln === "br" || ln === "cr") {
      out += "\n";
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

function countPageBreaks(node: XmlNode): number {
  let count = 0;
  const walk = (n: XmlNode): void => {
    const ln = localName(n.name);
    if (ln === "lastRenderedPageBreak") count++;
    if (ln === "br" && attr(n, "type") === "page") count++;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return count;
}

function hasDrawing(node: XmlNode): boolean {
  return descendants(node, "drawing").length > 0 || descendants(node, "pict").length > 0;
}

function cellText(tc: XmlNode): string {
  const parts: string[] = [];
  const collect = (n: XmlNode): void => {
    if (localName(n.name) === "p") {
      const t = cleanText(nodeText(n));
      if (t) parts.push(t);
      return;
    }
    for (const c of n.children) collect(c);
  };
  collect(tc);
  return parts.join("\n").trim();
}

function isTocStyle(name: string): boolean {
  return /^toc\s*\d/i.test(name) || /^目录\s*\d/.test(name);
}

function visibleLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55;
  }
  return n;
}

/**
 * 解析 DOCX 二进制为结构化正文。
 *
 * 读取 document.xml/styles.xml，构建段落、标题、表格和页码行号。
 */
export function parseDocxBuffer(buffer: Buffer): DocxDocument {
  const warnings: string[] = [];
  let archive: ZipArchive;
  try {
    archive = new ZipArchive(buffer);
  } catch (err) {
    throw new Error(`无法读取 DOCX 文件（不是有效的 OOXML 压缩包）：${(err as Error).message}`);
  }
  if (!archive.has("word/document.xml")) {
    throw new Error("无法读取 DOCX 文件：缺少 word/document.xml");
  }
  const documentXml = archive.readText("word/document.xml");
  const styles = parseStyles(archive.has("word/styles.xml") ? archive.readText("word/styles.xml") : undefined);
  const docNode = parseXml(documentXml);
  const body = descendants(docNode, "body")[0];
  if (!body) throw new Error("无法读取 DOCX 正文：缺少 w:body");

  const blocks: DocxBlock[] = [];
  const paragraphs: DocxParagraph[] = [];
  const tables: DocxTable[] = [];

  let page = 1;
  let line = 1;
  let pIndex = 0;
  let tIndex = 0;
  // Word embeds rendered page-break markers when the document was saved by Word.
  // When present they are authoritative; otherwise fall back to line-count estimation.
  const hasRenderedBreaks = documentXml.includes("lastRenderedPageBreak");

  const advanceLines = (lines: number): void => {
    line += lines;
    if (line > LINES_PER_PAGE) {
      if (!hasRenderedBreaks) page += Math.floor((line - 1) / LINES_PER_PAGE);
      line = ((line - 1) % LINES_PER_PAGE) + 1;
    }
  };

  for (const el of body.children) {
    const ln = localName(el.name);
    if (ln === "p") {
      const pPr = child(el, "pPr");
      const styleId = attr(pPr ? child(pPr, "pStyle") : undefined, "val");
      const style = styles.get(styleId);
      const styleName = style?.name ?? styleId ?? "";
      const headingLevel = styleHeadingLevel(style, styleId, pPr);
      const text = cleanText(nodeText(el));
      const breaks = countPageBreaks(el);
      const pageBreakBefore = pPr ? child(pPr, "pageBreakBefore") !== undefined : false;
      if (pageBreakBefore) {
        page += 1;
        line = 1;
      }
      if (breaks > 0) {
        page += breaks;
        line = 1;
      }
      const paragraph: DocxParagraph = {
        kind: "paragraph",
        index: pIndex++,
        text,
        styleId,
        styleName,
        headingLevel,
        isToc: isTocStyle(styleName),
        page,
        line,
        hasImage: hasDrawing(el),
        breaks,
      };
      paragraphs.push(paragraph);
      blocks.push(paragraph);
      if (!text) advanceLines(1);
      else advanceLines(Math.max(1, Math.ceil(visibleLength(text) / 42)) + (text.match(/\n/g)?.length ?? 0));
    } else if (ln === "tbl") {
      const tableBreaks = countPageBreaks(el);
      if (tableBreaks > 0) {
        page += tableBreaks;
        line = 1;
      }
      const rows: DocxRow[] = [];
      for (const tr of children(el, "tr")) {
        const row: DocxRow = { cells: [] };
        let gridColumn = 0;
        for (const tc of children(tr, "tc")) {
          const tcPr = child(tc, "tcPr");
          const span = Number(attr(tcPr ? child(tcPr, "gridSpan") : undefined, "val") || "1");
          const vMergeNode = tcPr ? child(tcPr, "vMerge") : undefined;
          const vMerge = vMergeNode
            ? attr(vMergeNode, "val") === "restart" || !attr(vMergeNode, "val")
              ? "restart"
              : "continue"
            : "none";
          row.cells.push({
            text: vMerge === "continue" ? "" : cellText(tc),
            colSpan: Number.isFinite(span) && span > 0 ? span : 1,
            vMerge,
            gridColumn,
          });
          gridColumn += Number.isFinite(span) && span > 0 ? span : 1;
        }
        rows.push(row);
        advanceLines(1);
      }
      const table: DocxTable = {
        kind: "table",
        index: tIndex++,
        rows,
        page,
        line,
      };
      tables.push(table);
      blocks.push(table);
    }
  }

  const pageCount = Math.max(page, 1);
  if (archive.has("docProps/app.xml")) {
    const app = parseXml(archive.readText("docProps/app.xml"));
    const pages = Number(descendants(app, "Pages")[0]?.children?.[0]?.text ?? "0");
    if (Number.isFinite(pages) && pages > pageCount && pages < pageCount * 3) {
      // Word sometimes reports a stale page count; only trust it when plausible.
      warnings.push(`文档属性记录 ${pages} 页，按分页标记估算 ${pageCount} 页，已采用排版标记估算值。`);
    }
  }

  if (tables.length === 0 && paragraphs.length === 0) warnings.push("DOCX 正文为空。");
  return { blocks, paragraphs, tables, pageCount, styleNames: new Map([...styles].map(([k, v]) => [k, v.name])), warnings };
}

export function parseDocxFile(filePath: string): DocxDocument {
  return parseDocxBuffer(readFileSync(filePath));
}

/** Split a table row into expanded grid columns, repeating merged cells only at their start column. */
export function expandedRow(row: DocxRow): { texts: string[]; colSpans: number[] } {
  const texts: string[] = [];
  const colSpans: number[] = [];
  let col = 0;
  for (const cell of row.cells) {
    while (col < cell.gridColumn) {
      texts.push("");
      colSpans.push(1);
      col++;
    }
    texts.push(cell.text);
    colSpans.push(cell.colSpan);
    for (let i = 1; i < cell.colSpan; i++) {
      texts.push("");
      colSpans.push(1);
    }
    col += cell.colSpan;
  }
  return { texts, colSpans };
}

/**
 * 把表格展开成二维文本矩阵。
 *
 * 合并单元格按起始列展开，便于后续按列读取。
 */
export function tableRows(table: DocxTable): string[][] {
  return table.rows.map((row) => expandedRow(row).texts);
}

function normalizeLabel(text: string): string {
  // Word tables often render labels as "需求 ID" / "父需求 ID"; normalize internal spaces.
  return text.trim().replace(/\s+/g, "");
}

/** Extract label/value pairs from definition-style tables (e.g. 需求ID | value | 父需求ID | value). */
export function tablePairs(table: DocxTable): Array<{ label: string; value: string }> {
  const pairs: Array<{ label: string; value: string }> = [];
  for (const row of table.rows) {
    const expanded = expandedRow(row);
    // Special case: 4-column header row containing two labels (需求ID / 父需求ID).
    const labels: number[] = [];
    expanded.texts.forEach((t, i) => {
      if (t && isLikelyLabel(t)) labels.push(i);
    });
    if (labels.length >= 2) {
      for (let k = 0; k < labels.length; k++) {
        const idx = labels[k];
        const nextLabel = k + 1 < labels.length ? labels[k + 1] : expanded.texts.length;
        const valueParts = expanded.texts.slice(idx + 1, nextLabel).filter((v) => v.trim());
        pairs.push({ label: normalizeLabel(expanded.texts[idx]), value: valueParts.join("；").trim() });
      }
    } else if (expanded.texts.length >= 2) {
      const label = normalizeLabel(expanded.texts[0]);
      const value = expanded.texts.slice(1).filter(Boolean).join("\n").trim();
      if (label) pairs.push({ label, value });
    }
  }
  return pairs;
}

/**
 * 判断单元格是否像定义式表格的标签。
 *
 * 会忽略“需求 ID”这类标签内部空格。
 */
export function isLikelyLabel(text: string): boolean {
  const t = normalizeLabel(text);
  if (!t || t.length > 16) return false;
  return /^(需求ID|父需求ID|需求描述|需求说明|测试规程|模块编号|子功能编号|模块名称|功能名称|功能描述|接口|输入|输出|编号|字段名称|字段含义|字段类型|字段长度|是否主键|默认值|说明|备注)$/.test(
    t,
  );
}
