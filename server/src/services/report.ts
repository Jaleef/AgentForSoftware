/**
 * 评价报告导出服务。
 *
 * 把 Campaign 和 Relation 转成 Markdown/CSV 报告。
 */

import type { Campaign, StoredDocument } from "../types.js";

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

const STATUS_TEXT: Record<string, string> = {
  satisfied: "已覆盖 / 已实现",
  partial: "部分覆盖",
  missing: "缺失",
  mismatch: "不一致",
  divergent: "偏离",
  unknown: "待确认",
};

function esc(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 生成 Markdown 评价报告。
 *
 * 包含总览、分桶、逐条关系、主要问题和覆盖比例。
 */
export function campaignMarkdown(
  campaign: Campaign,
  projectName: string,
  documents: { srs?: StoredDocument; sdd?: StoredDocument },
): string {
  const summary = campaign.summary;
  const lines: string[] = [];
  lines.push(`# ${projectName} · 一致性评价报告`);
  lines.push("");
  lines.push(`- 评价任务：${campaign.name}`);
  lines.push(`- 任务编号：${campaign.id}`);
  lines.push(`- 创建时间：${new Date(campaign.createdAt).toLocaleString("zh-CN")}`);
  lines.push(`- 评价层级：${campaign.levels.map((l) => (l === "requirement_design" ? "需求→设计" : "设计→代码")).join(" + ")}`);
  lines.push(`- 评价方法：${campaign.method === "llm" ? `LLM（${campaign.model}）` : "启发式规则"}`);
  lines.push(`- 需求文档：${documents.srs ? `${documents.srs.originalName}（${documents.srs.requirements.length} 条需求）` : "未上传"}`);
  lines.push(`- 设计文档：${documents.sdd ? `${documents.sdd.originalName}（${documents.sdd.designUnits.length} 个设计单元）` : "未上传"}`);
  lines.push("");
  if (summary) {
    lines.push("## 总览");
    lines.push("");
    lines.push("| 指标 | 数值 |");
    lines.push("| --- | --- |");
    lines.push(`| 一致性得分 | ${summary.score} / 100 |`);
    lines.push(`| 需求覆盖率 | ${pct(summary.requirementCoverage)} |`);
    lines.push(`| 设计实现覆盖率 | ${pct(summary.designCoverage)} |`);
    lines.push(`| 设计被需求追溯 | ${summary.designCovered} / ${summary.designTotal} |`);
    lines.push(`| 已覆盖 | ${summary.counts.satisfied} |`);
    lines.push(`| 部分覆盖 | ${summary.counts.partial} |`);
    lines.push(`| 缺失 | ${summary.counts.missing} |`);
    lines.push(`| 不一致 | ${summary.counts.mismatch} |`);
    lines.push(`| 偏离实现 | ${summary.counts.divergent} |`);
    lines.push(`| 门禁结论 | ${summary.gate === "pass" ? "通过" : summary.gate === "warn" ? "警告" : "不通过"} |`);
    lines.push("");
    lines.push("### 分子系统");
    lines.push("");
    lines.push("| 子系统 | 条目 | 已覆盖 | 部分 | 缺失 | 得分 |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const bucket of summary.bySubsystem) {
      lines.push(`| ${esc(bucket.key)} | ${bucket.total} | ${bucket.satisfied} | ${bucket.partial} | ${bucket.missing} | ${bucket.score} |`);
    }
    lines.push("");
  }
  lines.push("## 明细");
  lines.push("");
  lines.push("| 层级 | 来源 | 状态 | 联合覆盖 | 置信度 | 目标 | 说明 |");
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |");
  for (const relation of campaign.relations) {
    const level = relation.level === "requirement_design" ? "需求→设计" : "设计→代码";
    const targets = relation.targetNames.length ? relation.targetNames.join("；") : "—";
    const coverage = typeof relation.coverageRatio === "number" ? pct(relation.coverageRatio * 100) : "—";
    lines.push(
      `| ${level} | ${esc(relation.sourceCode)} ${esc(relation.sourceName)} | ${STATUS_TEXT[relation.status] ?? relation.status} | ${coverage} | ${(relation.confidence * 100).toFixed(0)}% | ${esc(targets)} | ${esc(relation.rationale)} |`,
    );
  }
  lines.push("");
  lines.push("## 主要问题");
  lines.push("");
  const issues = campaign.relations
    .filter((r) => ["missing", "mismatch", "divergent", "partial"].includes(r.status))
    .sort((a, b) => (a.severity === b.severity ? a.confidence - b.confidence : a.severity.localeCompare(b.severity)))
    .slice(0, 40);
  if (!issues.length) lines.push("未发现明显的一致性问题。");
  for (const relation of issues) {
    lines.push(`### [${relation.severity}] ${relation.sourceCode} ${relation.sourceName}`);
    lines.push("");
    lines.push(
      `- 判定：${STATUS_TEXT[relation.status] ?? relation.status}（联合覆盖 ${
        typeof relation.coverageRatio === "number" ? pct(relation.coverageRatio * 100) : "—"
      }，置信度 ${(relation.confidence * 100).toFixed(0)}%）`,
    );
    if (relation.targetNames.length) lines.push(`- 关联：${relation.targetNames.join("；")}`);
    lines.push(`- 依据：${relation.rationale}`);
    if (relation.evidence) lines.push(`- 证据：${relation.evidence}`);
    if (relation.gaps.length) lines.push(`- 缺口：${relation.gaps.join("；")}`);
    if (relation.suggestions) lines.push(`- 建议：${relation.suggestions}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("> 本报告由软件质量一致性评价 Agent 生成。LLM 判定用于辅助评审，最终结论需由评审人确认；静态代码分析不执行、不构建代码。");
  return lines.join("\n");
}

/**
 * 生成 CSV 评价报告。
 *
 * 每条关系一行，包含状态、覆盖率、目标、证据和审核状态。
 */
export function campaignCsv(campaign: Campaign): string {
  const header = [
    "id",
    "level",
    "sourceCode",
    "sourceName",
    "sourceType",
    "subsystem",
    "status",
    "severity",
    "confidence",
    "coverageRatio",
    "targetCodes",
    "targetNames",
    "rationale",
    "evidence",
    "gaps",
    "suggestions",
    "method",
    "reviewStatus",
  ];
  const rows = campaign.relations.map((r) =>
    [
      r.id,
      r.level,
      r.sourceCode,
      r.sourceName,
      r.sourceType,
      r.sourceSubsystem,
      r.status,
      r.severity,
      String(r.confidence),
      r.coverageRatio ?? "",
      r.targetCodes.join(";"),
      r.targetNames.join(";"),
      r.rationale,
      r.evidence,
      r.gaps.join(";"),
      r.suggestions,
      r.method,
      r.reviewStatus,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""').replace(/\r?\n/g, " ")}"`)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

export function reportFileName(campaign: Campaign, ext: string): string {
  const stamp = campaign.createdAt.slice(0, 10);
  return `consistency-report-${stamp}-${campaign.id.slice(-6)}.${ext}`;
}

