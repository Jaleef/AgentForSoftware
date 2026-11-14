/**
 * XML DOM 适配层。
 *
 * 使用 fast-xml-parser 解析 OOXML，并转换为项目内部的 XmlNode。保留
 * preserveOrder 以维持 w:p / w:tbl 在正文中的顺序；docx.ts 仍然只依赖
 * XmlNode，不直接接触第三方 AST。
 */

import { XMLParser } from "fast-xml-parser";

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function localName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  const target = localName(name);
  return node.children.find((c) => localName(c.name) === target);
}

export function children(node: XmlNode, name: string): XmlNode[] {
  const target = localName(name);
  return node.children.filter((c) => localName(c.name) === target);
}

export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  const target = localName(name);
  for (const c of node.children) {
    if (localName(c.name) === target) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

export function attr(node: XmlNode | undefined, name: string): string {
  if (!node) return "";
  if (name in node.attrs) return node.attrs[name];
  for (const key of Object.keys(node.attrs)) {
    if (localName(key) === name) return node.attrs[key];
  }
  return "";
}

function attrsOf(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.startsWith("@") ? key.slice(1) : key;
    attrs[name] = String(value ?? "");
  }
  return attrs;
}

/**
 * 把 fast-xml-parser 的 preserveOrder 数组转换为 XmlNode。
 *
 * 第三方格式：{ "w:p": [...children], ":@": { "@w:val": "..." } }
 * 内部格式：{ name: "w:p", attrs, children, text }
 * 文本节点保留为 name="#text"，兼容 docx.ts 的现有遍历逻辑。
 */
function convertEntries(entries: unknown[]): XmlNode[] {
  const result: XmlNode[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record["#text"] === "string") {
      result.push({ name: "#text", attrs: {}, children: [], text: record["#text"] });
      continue;
    }
    for (const [name, value] of Object.entries(record)) {
      if (name === "#text" || name === ":@") continue;
      const children = Array.isArray(value) ? convertEntries(value) : [];
      result.push({ name, attrs: attrsOf(record[":@"]), children, text: "" });
    }
  }
  return result;
}

/**
 * 解析 OOXML/XML 文本。
 *
 * 调用 fast-xml-parser 的 XMLParser，开启 preserveOrder 以保留表格和
 * 段落的原始顺序。XML 不合法时抛出 Error，由 docx.ts 包装为解析失败。
 */
export function parseXml(xml: string): XmlNode {
  try {
    const parsed = parser.parse(xml) as unknown[];
    return {
      name: "#document",
      attrs: {},
      children: convertEntries(Array.isArray(parsed) ? parsed : []),
      text: "",
    };
  } catch (error) {
    throw new Error(`XML 解析失败：${(error as Error).message}`);
  }
}
