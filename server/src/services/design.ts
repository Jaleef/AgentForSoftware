/**
 * 设计单元人工维护服务。
 *
 * 构造 `SDD-MAN-NNN` 手工设计单元，并支持删除及同步移除设计点。
 */

import type { DesignUnit, DesignUnitType, StoredDocument } from "../types.js";
import { extractKeywords, firstSentences, splitSentences } from "../util/text.js";
import { nowIso } from "../util/id.js";
import { getStore, mutateStore } from "../store.js";
import { recomputeDesignStats } from "./documents.js";

const DESIGN_TYPES: DesignUnitType[] = ["模块", "子功能", "数据表", "页面"];

export interface ManualDesignInput {
  type?: string;
  name?: string;
  description?: string;
  detail?: string;
  subsystem?: string;
  interfaceText?: string;
  input?: string;
  output?: string;
  obligations?: string[] | string;
  sourceId?: string;
  reviewNote?: string;
}

function latestSdd(data: Awaited<ReturnType<typeof getStore>>, projectId: string): StoredDocument | undefined {
  return data.documents
    .filter((doc) => doc.projectId === projectId && doc.kind === "sdd")
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

function nextManualCode(existing: DesignUnit[]): string {
  const used = new Set(existing.map((unit) => unit.code));
  let seq = 1;
  while (used.has(`SDD-MAN-${String(seq).padStart(3, "0")}`)) seq++;
  return `SDD-MAN-${String(seq).padStart(3, "0")}`;
}

function normalizeObligations(input: ManualDesignInput, description: string, interfaceText: string, inputText: string, outputText: string): string[] {
  const raw = Array.isArray(input.obligations)
    ? input.obligations
    : String(input.obligations ?? "").split(/\r?\n|；|;/);
  const provided = raw
    .map((item) => String(item).trim().replace(/^[-*·•]\s*/, ""))
    .filter((item) => item.length >= 3);
  if (provided.length) return provided.slice(0, 12);
  const base = splitSentences(description)
    .map((sentence) => sentence.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
    .filter((sentence) => sentence.length >= 6);
  if (interfaceText.trim()) base.push(`提供接口：${firstSentences(interfaceText, 100)}`);
  if (inputText.trim()) base.push(`接收输入：${firstSentences(inputText, 80)}`);
  if (outputText.trim()) base.push(`产出结果：${firstSentences(outputText, 80)}`);
  return base.slice(0, 10);
}

/**
 * 构造手工设计单元。
 *
 * 生成 SDD-MAN 编号、摘要、义务和关键词，并标记为已审核。
 */
export function buildManualDesignUnit(input: ManualDesignInput, existing: DesignUnit[]): DesignUnit {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) throw new Error("设计单元名称不能为空");
  const type = DESIGN_TYPES.includes(input.type as DesignUnitType) ? (input.type as DesignUnitType) : "模块";
  const description = String(input.description ?? "").trim() || name;
  const detail = String(input.detail ?? "").trim();
  const interfaceText = String(input.interfaceText ?? "").trim();
  const inputText = String(input.input ?? "").trim();
  const outputText = String(input.output ?? "").trim();
  return {
    code: nextManualCode(existing),
    sourceKind: "manual",
    structureOrigin: "manual",
    sourceId: String(input.sourceId ?? "").trim(),
    parentSourceId: "",
    type,
    subsystem: String(input.subsystem ?? "").trim().slice(0, 80) || "全局",
    name,
    description,
    detail,
    interfaceText,
    input: inputText,
    output: outputText,
    chapter: "手工添加",
    chapterPath: ["手工添加"],
    location: { page: 0, line: 0 },
    confidence: 1,
    origin: "manual",
    summary: firstSentences(detail || description, 160),
    obligations: normalizeObligations(input, description, interfaceText, inputText, outputText),
    keywords: extractKeywords(`${name} ${description} ${interfaceText}`, 18),
    fields: [],
    reviewStatus: "confirmed",
    reviewNote: String(input.reviewNote ?? "").trim() || "手工添加",
  };
}

/**
 * 新增手工设计单元。
 *
 * 写入最新设计文档并重算统计。
 */
export async function addManualDesignUnit(projectId: string, input: ManualDesignInput): Promise<DesignUnit> {
  const result = await mutateStore((data) => {
    const doc = latestSdd(data, projectId);
    if (!doc) return undefined;
    const unit = buildManualDesignUnit(input, doc.designUnits);
    doc.designUnits.push(unit);
    doc.updatedAt = nowIso();
    recomputeDesignStats(doc);
    const project = data.projects.find((item) => item.id === projectId);
    if (project) project.updatedAt = nowIso();
    return unit;
  });
  if (!result) throw new Error("尚未上传设计文档，无法添加设计单元");
  return result;
}

/**
 * 删除设计单元。
 *
 * 同步移除对应设计点；LLM 整理期间拒绝删除。
 */
export async function deleteDesignUnit(projectId: string, code: string): Promise<DesignUnit | undefined> {
  return mutateStore((data) => {
    const doc = latestSdd(data, projectId);
    if (!doc) return undefined;
    if (doc.status === "enriching") throw new Error("文档正在 LLM 整理，请完成后再删除设计单元");
    const unit = doc.designUnits.find((item) => item.code === code);
    if (!unit) return undefined;
    doc.designUnits = doc.designUnits.filter((item) => item.code !== code);
    if (unit.pointId) {
      doc.designPoints = (doc.designPoints ?? []).filter((point) => point.id !== unit.pointId);
    }
    doc.updatedAt = nowIso();
    recomputeDesignStats(doc);
    const project = data.projects.find((item) => item.id === projectId);
    if (project) project.updatedAt = nowIso();
    return unit;
  });
}
