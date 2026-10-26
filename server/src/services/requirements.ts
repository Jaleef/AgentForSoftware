import type { RequirementType, RequirementUnit, StoredDocument } from "../types.js";
import { REQUIREMENT_TYPES } from "../types.js";
import { extractKeywords, firstSentences, splitSentences } from "../util/text.js";
import { nowIso } from "../util/id.js";
import { getStore, mutateStore } from "../store.js";
import { recomputeRequirementStats } from "./documents.js";

export interface ManualRequirementInput {
  type?: string;
  title?: string;
  description?: string;
  detail?: string;
  subsystem?: string;
  testSpec?: string;
  obligations?: string[] | string;
  sourceId?: string;
  reviewNote?: string;
}

function latestSrs(data: Awaited<ReturnType<typeof getStore>>, projectId: string): StoredDocument | undefined {
  return data.documents
    .filter((doc) => doc.projectId === projectId && doc.kind === "srs")
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

function nextManualCode(existing: RequirementUnit[]): string {
  const used = new Set(existing.map((unit) => unit.code));
  let seq = 1;
  while (used.has(`SRS-MAN-${String(seq).padStart(3, "0")}`)) seq++;
  return `SRS-MAN-${String(seq).padStart(3, "0")}`;
}

function normalizeObligations(input: ManualRequirementInput, description: string, detail: string): string[] {
  const raw = Array.isArray(input.obligations)
    ? input.obligations
    : String(input.obligations ?? "").split(/\r?\n|；|;/);
  const provided = raw
    .map((item) => String(item).trim().replace(/^[-*·•]\s*/, ""))
    .filter((item) => item.length >= 3);
  if (provided.length) return provided.slice(0, 12);
  return splitSentences(`${description}。${detail}`)
    .map((sentence) => sentence.replace(/^[0-9一二三四五六七八九十]+[、.．)]\s*/, "").trim())
    .filter((sentence) => sentence.length >= 6)
    .slice(0, 8);
}

export function buildManualRequirement(
  input: ManualRequirementInput,
  existing: RequirementUnit[],
): RequirementUnit {
  const description = String(input.description ?? "").trim();
  if (!description) throw new Error("需求描述不能为空");
  const detail = String(input.detail ?? "").trim();
  const type = REQUIREMENT_TYPES.includes(input.type as RequirementType)
    ? (input.type as RequirementType)
    : "其他需求";
  const title = String(input.title ?? "").trim().slice(0, 120) || firstSentences(description, 64);
  const obligations = normalizeObligations(input, description, detail);
  return {
    code: nextManualCode(existing),
    sourceKind: "manual",
    structureOrigin: "manual",
    sourceId: String(input.sourceId ?? "").trim(),
    parentSourceId: "",
    type,
    subsystem: String(input.subsystem ?? "").trim().slice(0, 80) || "全局",
    title,
    description,
    detail,
    testSpec: String(input.testSpec ?? "").trim(),
    chapter: "手工添加",
    chapterPath: ["手工添加"],
    location: { page: 0, line: 0 },
    confidence: 1,
    origin: "manual",
    summary: firstSentences(detail || description, 120),
    obligations,
    keywords: extractKeywords(`${description} ${detail}`, 16),
    reviewStatus: "confirmed",
    reviewNote: String(input.reviewNote ?? "").trim() || "手工添加",
  };
}

export async function addManualRequirement(
  projectId: string,
  input: ManualRequirementInput,
): Promise<RequirementUnit> {
  const result = await mutateStore((data) => {
    const doc = latestSrs(data, projectId);
    if (!doc) return undefined;
    const unit = buildManualRequirement(input, doc.requirements);
    doc.requirements.push(unit);
    doc.updatedAt = nowIso();
    recomputeRequirementStats(doc);
    const project = data.projects.find((item) => item.id === projectId);
    if (project) project.updatedAt = nowIso();
    return unit;
  });
  if (!result) throw new Error("尚未上传需求文档，无法添加需求单元");
  return result;
}

export async function deleteRequirementUnit(
  projectId: string,
  code: string,
): Promise<RequirementUnit | undefined> {
  return mutateStore((data) => {
    const doc = latestSrs(data, projectId);
    if (!doc) return undefined;
    if (doc.status === "enriching") throw new Error("文档正在 LLM 整理，请完成后再删除需求单元");
    const unit = doc.requirements.find((item) => item.code === code);
    if (!unit) return undefined;
    doc.requirements = doc.requirements.filter((item) => item.code !== code);
    if (unit.pointId) {
      // Remove the underlying point as well, otherwise a later LLM run would recreate it.
      doc.requirementPoints = (doc.requirementPoints ?? []).filter((point) => point.id !== unit.pointId);
    }
    doc.updatedAt = nowIso();
    recomputeRequirementStats(doc);
    const project = data.projects.find((item) => item.id === projectId);
    if (project) project.updatedAt = nowIso();
    return unit;
  });
}
