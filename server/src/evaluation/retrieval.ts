/**
 * 本地混合检索与候选打分。
 *
 * 把需求、设计单元和代码符号转成 token，计算相似度并生成 Top N 候选。
 */

import type { CodeSnapshot, CodeSymbol, DesignUnit, RequirementUnit } from "../types.js";
import { jaccard, overlapScore, tokenSet, tokenize } from "../util/text.js";

export interface DesignIndexEntry {
  unit: DesignUnit;
  tokens: Set<string>;
  nameTokens: Set<string>;
}

export interface SymbolIndexEntry {
  symbol: CodeSymbol & { file: string };
  tokens: Set<string>;
  nameTokens: Set<string>;
  snippetTokens: Set<string>;
}

export function designSearchText(unit: DesignUnit): string {
  return [
    unit.name,
    unit.summary,
    unit.description,
    unit.interfaceText,
    unit.input,
    unit.output,
    ...unit.obligations,
    ...unit.keywords,
    ...unit.fields.map((f) => `${f.name} ${f.meaning}`),
    unit.subsystem,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 为设计单元建立可复用的 token 索引。
 *
 * 索引字段包括名称、摘要、描述、接口、输入输出、义务、关键词、字段和子系统。
 */
export function buildDesignIndex(units: DesignUnit[]): DesignIndexEntry[] {
  return units.map((unit) => {
    const text = designSearchText(unit);
    return { unit, tokens: tokenSet(text), nameTokens: tokenSet(`${unit.name} ${unit.interfaceText}`) };
  });
}

/** Design-type affinity used by both lexical and hybrid retrieval reranking. */
export function designTypeAffinity(requirementType: string, designType: string): number {
  if (requirementType === "功能需求") {
    return designType === "子功能" || designType === "模块" ? 0.12 : 0;
  }
  if (requirementType === "页面/人机交互需求") {
    return designType === "页面" ? 0.26 : designType === "子功能" ? 0.04 : 0;
  }
  if (requirementType === "数据需求" || requirementType === "元数据需求") {
    return designType === "数据表" ? 0.24 : designType === "子功能" ? 0.06 : 0;
  }
  if (requirementType === "接口需求") {
    return designType === "子功能" || designType === "模块" ? 0.12 : 0;
  }
  if (requirementType === "性能需求") {
    return designType === "模块" || designType === "子功能" ? 0.08 : 0;
  }
  if (requirementType === "设计实现约束") {
    return designType === "模块" || designType === "子功能" ? 0.06 : 0;
  }
  return 0.05;
}

export interface RankedDesign {
  unit: DesignUnit;
  score: number;
}

/**
 * 为一条需求排序设计候选。
 *
 * 融合加权 token 覆盖率、Jaccard、类型亲和度、同子系统加分和标题重合度。
 */
export function rankDesignCandidates(
  requirement: RequirementUnit,
  index: DesignIndexEntry[],
  limit = 8,
): RankedDesign[] {
  const reqTokens = tokenSet(
    `${requirement.title} ${requirement.description} ${requirement.detail} ${requirement.summary} ${requirement.obligations.join(" ")} ${requirement.keywords.join(" ")}`,
  );
  const titleTokens = tokenSet(`${requirement.title} ${requirement.keywords.join(" ")}`);
  // 给候选设计单元打分，综合考虑需求与设计的文本相似度、类型匹配、子系统匹配等因素
  /**
   * 候选分 = 加权 token 覆盖率 × 0.68
              +Jaccard × 0.22
              + 类型亲和度
              + 同子系统加分
              + 标题/名称重合度 × 0.14
   */
  const scored = index.map((entry) => {
    const base = overlapScore(reqTokens, entry.tokens) * 0.68 + jaccard(reqTokens, entry.tokens) * 0.22;
    let bonus = designTypeAffinity(requirement.type, entry.unit.type);
    if (requirement.subsystem !== "全局" && entry.unit.subsystem === requirement.subsystem) bonus += 0.09;
    bonus += overlapScore(titleTokens, entry.nameTokens) * 0.14;
    return { unit: entry.unit, score: base + bonus };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * 为代码快照建立符号检索索引。
 *
 * 合并符号名、签名、文件路径和代码片段 token。
 */
export function buildSymbolIndex(snapshot: CodeSnapshot): SymbolIndexEntry[] {
  const entries: SymbolIndexEntry[] = [];
  for (const file of snapshot.files) {
    const pathTokens = tokenSet(file.path);
    for (const symbol of file.symbols) {
      const tokens = tokenSet(`${symbol.name} ${symbol.signature} ${symbol.file}`);
      for (const t of pathTokens) tokens.add(t);
      entries.push({
        symbol,
        tokens,
        nameTokens: tokenSet(`${symbol.name} ${symbol.file}`),
        snippetTokens: tokenSet(symbol.snippet),
      });
    }
  }
  return entries;
}

const TYPE_WORDS = new Set(["bool", "boolean", "string", "int", "integer", "object", "list", "map", "date", "file", "void", "double", "float", "long", "array"]);
const GENERIC_IDENTIFIERS = new Set([
  "load",
  "get",
  "set",
  "init",
  "run",
  "start",
  "stop",
  "main",
  "render",
  "update",
  "delete",
  "create",
  "find",
  "list",
  "search",
  "save",
  "read",
  "write",
  "open",
  "close",
  "call",
  "apply",
  "handle",
]);

function designIdentifiers(design: DesignUnit): string[] {
  const text = `${design.interfaceText}\n${design.obligations.join("\n")}\n${design.name}\n${design.description}`;
  const ids = new Set<string>();
  for (const match of text.matchAll(/([A-Za-z_$][A-Za-z0-9_$]{2,})\s*\(/g)) {
    const id = match[1].toLowerCase();
    if (!TYPE_WORDS.has(id) && !GENERIC_IDENTIFIERS.has(id)) ids.add(id);
  }
  return [...ids].slice(0, 12);
}

export interface RankedSymbol {
  symbol: CodeSymbol;
  score: number;
}

/**
 * 为一个设计单元排序代码符号候选。
 *
 * 结合文本、代码片段、接口标识符、模型/路由类型和同文件配额。
 */
export function rankCodeCandidates(
  design: DesignUnit,
  index: SymbolIndexEntry[],
  limit = 8,
): RankedSymbol[] {
  const designTokens = tokenSet(designSearchText(design));
  const nameTokens = tokenSet(design.name);
  const identifiers = designIdentifiers(design);
  const fields = design.fields.map((f) => f.name.toLowerCase()).filter((f) => f.length >= 2);
  const scored = index.map((entry) => {
    const base =
      overlapScore(designTokens, entry.tokens) * 0.55 +
      overlapScore(designTokens, entry.snippetTokens) * 0.1 +
      jaccard(designTokens, entry.tokens) * 0.1;
    let bonus = 0;
    const symbolName = entry.symbol.name.toLowerCase();
    for (const id of identifiers) {
      if (symbolName === id) bonus += 0.32;
      else if (symbolName.includes(id) || id.includes(symbolName)) bonus += 0.2;
      else if (entry.tokens.has(id)) bonus += 0.1;
    }
    bonus = Math.min(bonus, 0.5);
    if (entry.symbol.kind === "method" && identifiers.length > 0) bonus += 0.03;
    if (design.type === "数据表" && (entry.symbol.kind === "model" || entry.symbol.kind === "table")) {
      bonus += 0.18;
      let fieldHits = 0;
      for (const field of fields) {
        if (symbolName === field || entry.tokens.has(field) || entry.snippetTokens.has(field)) fieldHits++;
      }
      bonus += Math.min(0.3, fieldHits * 0.04);
    }
    if (design.type === "页面" && entry.symbol.kind === "component") bonus += 0.22;
    if (design.type === "页面" && entry.symbol.kind === "route") bonus += 0.06;
    if (design.type === "子功能" && entry.symbol.kind === "route") bonus += 0.05;
    bonus += overlapScore(nameTokens, entry.nameTokens) * 0.18;
    return { symbol: entry.symbol, score: base + bonus };
  });
  scored.sort((a, b) => b.score - a.score);
  const selected: RankedSymbol[] = [];
  const perFile = new Map<string, number>();
  for (const item of scored) {
    const count = perFile.get(item.symbol.file) ?? 0;
    if (count >= 2) continue;
    selected.push(item);
    perFile.set(item.symbol.file, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}


