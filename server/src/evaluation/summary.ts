/**
 * 评价结果汇总。
 *
 * 计算覆盖率、一致性得分、子系统/类型分桶、风险等级和门禁结论。
 */

import type {
  CampaignSummary,
  DesignUnit,
  Relation,
  RelationLevel,
  RelationStatus,
  RequirementUnit,
  ScoreBucket,
} from "../types.js";

const SCORE_WEIGHT: Record<RelationStatus, number> = {
  satisfied: 100,
  partial: 60,
  mismatch: 20,
  divergent: 30,
  missing: 0,
  unknown: 50,
};

/**
 * 根据状态和层级计算风险等级。
 *
 * 功能/接口/数据等关键需求缺失为 P0，其余非通过项为 P1/P2。
 */
export function severityFor(status: RelationStatus, level: RelationLevel, sourceType: string): "P0" | "P1" | "P2" | "none" {
  if (status === "satisfied" || status === "unknown") return "none";
  if (status === "partial") return "P1";
  if (level === "requirement_design") {
    if (["功能需求", "接口需求", "数据需求", "页面/人机交互需求", "性能需求"].includes(sourceType)) return "P0";
    return "P1";
  }
  if (["子功能", "模块", "数据表"].includes(sourceType)) return "P0";
  return "P1";
}

function relationScore(relation: Relation): number {
  // Requirement→design partial coverage should reflect how many obligations
  // are actually covered (0-100), not a flat 60 for every partial relation.
  if (
    relation.level === "requirement_design" &&
    typeof relation.coverageRatio === "number" &&
    (relation.status === "satisfied" || relation.status === "partial")
  ) {
    return Math.max(0, Math.min(1, relation.coverageRatio)) * 100;
  }
  return SCORE_WEIGHT[relation.status];
}

function bucketScore(relations: Relation[]): number {
  if (!relations.length) return 0;
  const sum = relations.reduce((acc, relation) => acc + relationScore(relation), 0) / relations.length;
  return Math.round(sum * 10) / 10;
}

function buildBuckets(relations: Relation[], keyOf: (r: Relation) => string): ScoreBucket[] {
  const groups = new Map<string, Relation[]>();
  for (const relation of relations) {
    const key = keyOf(relation) || "未分类";
    const list = groups.get(key) ?? [];
    list.push(relation);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      total: list.length,
      satisfied: list.filter((r) => r.status === "satisfied").length,
      partial: list.filter((r) => r.status === "partial").length,
      missing: list.filter((r) => r.status === "missing").length,
      other: list.filter((r) => !["satisfied", "partial", "missing"].includes(r.status)).length,
      score: bucketScore(list),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * 根据关系列表计算评价总览。
 *
 * 计算覆盖率、得分、分子系统/类型分桶、风险统计和门禁结论。
 */
export function computeSummary(
  relations: Relation[],
  designUnits: DesignUnit[],
  requirementCount: number,
): CampaignSummary {
  const levelRelations = (level: RelationLevel): Relation[] => relations.filter((r) => r.level === level);
  const rd = levelRelations("requirement_design");
  const dc = levelRelations("design_code");
  const levelScore = (level: RelationLevel): number => bucketScore(levelRelations(level));

  const score = rd.length && dc.length
    ? Math.round(((levelScore("requirement_design") + levelScore("design_code")) / 2) * 10) / 10
    : levelScore(rd.length ? "requirement_design" : "design_code");

  const satisfiedIn = (list: Relation[]): number => list.filter((r) => r.status === "satisfied").length;
  const partialIn = (list: Relation[]): number => list.filter((r) => r.status === "partial").length;

  // Prefer obligation-level union coverage when present; legacy relations fall
  // back to the satisfied / partial status weights.
  const coverageRatioOf = (relation: Relation): number => {
    if (typeof relation.coverageRatio === "number") {
      return Math.max(0, Math.min(1, relation.coverageRatio));
    }
    if (relation.status === "satisfied") return 1;
    if (relation.status === "partial") return 0.5;
    return 0;
  };
  const requirementCoverage = rd.length
    ? Math.round(
        (rd.reduce((sum, relation) => sum + coverageRatioOf(relation), 0) /
          Math.max(requirementCount, rd.length)) *
          1000,
      ) / 10
    : 0;
  const designCoverage = dc.length
    ? Math.round(((satisfiedIn(dc) + 0.5 * partialIn(dc)) / Math.max(designUnits.length, dc.length)) * 1000) / 10
    : 0;

  const referenced = new Set<string>();
  for (const relation of rd) for (const code of relation.targetCodes) referenced.add(code);
  const designTotal = designUnits.length;

  const counts = {
    total: relations.length,
    satisfied: relations.filter((r) => r.status === "satisfied").length,
    partial: relations.filter((r) => r.status === "partial").length,
    missing: relations.filter((r) => r.status === "missing").length,
    mismatch: relations.filter((r) => r.status === "mismatch").length,
    divergent: relations.filter((r) => r.status === "divergent").length,
  };

  const findings = {
    p0: relations.filter((r) => r.severity === "P0").length,
    p1: relations.filter((r) => r.severity === "P1").length,
    p2: relations.filter((r) => r.severity === "P2").length,
  };

  const gate = score >= 85 ? "pass" : score >= 70 ? "warn" : "fail";

  return {
    score,
    requirementCoverage,
    designCoverage,
    designCovered: referenced.size,
    designTotal,
    counts,
    gate,
    bySubsystem: buildBuckets(relations, (r) => r.sourceSubsystem),
    byType: buildBuckets(relations, (r) => (r.level === "requirement_design" ? `需求·${r.sourceType}` : `设计·${r.sourceType}`)),
    byLevel: {
      requirement_design: { total: rd.length, score: levelScore("requirement_design") },
      design_code: { total: dc.length, score: levelScore("design_code") },
    },
    findings,
  };
}

export function coverageOfUnit(unit: RequirementUnit | DesignUnit): number {
  return unit.obligations.length > 0 ? Math.min(1, unit.obligations.length / 6) : 0.4;
}
