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

function bucketScore(relations: Relation[]): number {
  if (!relations.length) return 0;
  const sum = relations.reduce((acc, r) => acc + SCORE_WEIGHT[r.status], 0) / relations.length;
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

  const requirementCoverage = rd.length
    ? Math.round(((satisfiedIn(rd) + 0.5 * partialIn(rd)) / Math.max(requirementCount, rd.length)) * 1000) / 10
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
