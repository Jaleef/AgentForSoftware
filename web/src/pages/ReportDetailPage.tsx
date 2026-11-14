/**
 * 评价报告详情页。
 *
 * 展示完整报告、门禁结论和关系明细，支持打印/导出。
 */

import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatDate, percent } from "../api";
import { useResource } from "../hooks";
import {
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  ProgressBar,
  ScoreRing,
  Spinner,
  Tag,
} from "../components/ui";
import { IconArrowLeft, IconDownload, IconReport } from "../components/Icons";
import { levelLabel } from "../utils";
import type { Relation } from "../types";
import { STATUS_LABEL, STATUS_TONE } from "../types";

/**
 * 报告详情页面入口。
 *
 * 展示总览、分桶、逐条关系和打印/导出操作。
 */
export function ReportDetailPage() {
  const { projectId = "", campaignId = "" } = useParams();
  const navigate = useNavigate();
  const campaign = useResource(() => api.getCampaign(projectId, campaignId), [projectId, campaignId], {
    key: "campaign",
  });
  const project = useResource(() => api.getProject(projectId), [projectId], { key: "project" });
  const documents = useResource(() => api.listDocuments(projectId), [projectId], { key: "documents" });

  if (campaign.loading && !campaign.data) {
    return (
      <div className="loading-block">
        <Spinner label="加载报告…" />
      </div>
    );
  }

  if (!campaign.data || !campaign.data.summary) {
    return (
      <>
        <PageHeader title="评价报告" />
        <Card>
          <EmptyState
            icon={<IconReport size={30} />}
            title="报告尚未生成"
            description={campaign.data?.error ?? "任务需完成后才能生成报告。"}
            actions={
              <Button variant="primary" size="sm" onClick={() => navigate(`/projects/${projectId}/evaluation`)}>
                查看评价任务
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const item = campaign.data;
  const summary = item.summary!;
  const srs = documents.data?.find((doc) => doc.kind === "srs");
  const sdd = documents.data?.find((doc) => doc.kind === "sdd");
  const issues = item.relations
    .filter((relation) => ["missing", "mismatch", "divergent", "partial"].includes(relation.status))
    .sort((a, b) => {
      const order = { P0: 0, P1: 1, P2: 2, none: 3 };
      return order[a.severity] - order[b.severity] || b.confidence - a.confidence;
    });

  return (
    <>
      <PageHeader
        title="一致性评价报告"
        subtitle={`${project.data?.name ?? ""} · ${item.name}`}
        actions={
          <>
            <Button variant="ghost" icon={<IconArrowLeft size={16} />} onClick={() => navigate(`/projects/${projectId}/reports`)}>
              返回
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              打印 / PDF
            </Button>
            <a className="btn btn-primary btn-md" href={api.exportReportUrl(projectId, item.id, "md")} target="_blank" rel="noreferrer">
              <IconDownload size={15} /> 导出 Markdown
            </a>
          </>
        }
      />

      {item.warnings?.length ? (
        <Notice tone="amber">
          {item.warnings.map((warning, index) => (
            <div key={index}>{warning}</div>
          ))}
        </Notice>
      ) : null}

      <Card className="report-meta-card">
        <div className="report-meta-grid">
          <div>
            <span>项目</span>
            <strong>{project.data?.name ?? "—"}</strong>
          </div>
          <div>
            <span>需求文档</span>
            <strong>{srs ? `${srs.originalName}（${srs.requirementCount} 条）` : "未上传"}</strong>
          </div>
          <div>
            <span>设计文档</span>
            <strong>{sdd ? `${sdd.originalName}（${sdd.designCount} 个单元）` : "未上传"}</strong>
          </div>
          <div>
            <span>评价层级</span>
            <strong>{item.levels.map(levelLabel).join(" + ")}</strong>
          </div>
          <div>
            <span>评价方法</span>
            <strong>{item.method === "llm" ? `LLM · ${item.model}` : "启发式规则"}</strong>
          </div>
          <div>
            <span>完成时间</span>
            <strong>{formatDate(item.finishedAt ?? item.createdAt)}</strong>
          </div>
        </div>
      </Card>

      <Card label="SCORE" title="一致性总览">
        <div className="summary-layout">
          <div className="summary-score">
            <ScoreRing score={summary.score} size={150} />
            <div className="summary-tags">
              <Tag tone={summary.gate === "pass" ? "green" : summary.gate === "warn" ? "amber" : "red"}>
                {summary.gate === "pass" ? "门禁通过" : summary.gate === "warn" ? "门禁警告" : "门禁不通过"}
              </Tag>
              <Tag tone="gray">P0 {summary.findings.p0} · P1 {summary.findings.p1} · P2 {summary.findings.p2}</Tag>
            </div>
          </div>
          <div className="summary-metrics">
            <div className="metric">
              <div className="metric-label">需求覆盖率</div>
              <div className="metric-value">{percent(summary.requirementCoverage)}</div>
              <ProgressBar value={summary.requirementCoverage} tone="green" />
              <div className="muted small">
                已覆盖 {summary.counts.satisfied}，部分 {summary.counts.partial}，缺失 {summary.counts.missing}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">设计实现覆盖率</div>
              <div className="metric-value">{percent(summary.designCoverage)}</div>
              <ProgressBar value={summary.designCoverage} tone="blue" />
              <div className="muted small">
                设计被需求追溯 {summary.designCovered} / {summary.designTotal}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">按层级得分</div>
              <div className="level-scores">
                {Object.entries(summary.byLevel).map(([level, value]) => (
                  <div key={level}>
                    <span>{levelLabel(level)}</span>
                    <strong>{value.score.toFixed(1)}</strong>
                    <em>{value.total} 条</em>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="report-two-col">
        <Card label="SUBSYSTEM" title="分子系统得分">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>子系统</th>
                <th>条目</th>
                <th>已覆盖</th>
                <th>部分</th>
                <th>缺失</th>
                <th>得分</th>
              </tr>
            </thead>
            <tbody>
              {summary.bySubsystem.map((bucket) => (
                <tr key={bucket.key}>
                  <td>{bucket.key}</td>
                  <td>{bucket.total}</td>
                  <td>{bucket.satisfied}</td>
                  <td>{bucket.partial}</td>
                  <td>{bucket.missing}</td>
                  <td>
                    <span className={`score-cell ${bucket.score >= 85 ? "ok" : bucket.score >= 70 ? "warn" : "bad"}`}>
                      {bucket.score.toFixed(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card label="TYPE" title="按类型得分">
          <div className="bucket-list">
            {summary.byType.slice(0, 10).map((bucket) => (
              <div key={bucket.key} className="bucket-row">
                <span>{bucket.key}</span>
                <div className="bucket-bar">
                  <ProgressBar value={bucket.score} tone={bucket.score >= 85 ? "green" : bucket.score >= 70 ? "amber" : "red"} />
                </div>
                <strong>{bucket.score.toFixed(1)}</strong>
                <em>{bucket.total}</em>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card label="FINDINGS" title={`主要问题 (${issues.length})`}>
        {issues.length ? (
          <div className="issue-list">
            {issues.slice(0, 40).map((relation) => (
              <IssueCard key={relation.id} relation={relation} />
            ))}
            {issues.length > 40 && <div className="muted small">仅展示前 40 条，完整清单请导出 CSV。</div>}
          </div>
        ) : (
          <EmptyState compact title="未发现明显问题" description="所有需求与设计均被判定为已覆盖。" />
        )}
      </Card>

      <Card label="DETAIL" title="全部判定明细">
        <div className="table-wrap">
          <table className="data-table relation-table">
            <thead>
              <tr>
                <th>层级</th>
                <th>来源</th>
                <th>状态</th>
                <th>置信度</th>
                <th>目标</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {item.relations.map((relation) => (
                <tr key={relation.id}>
                  <td>
                    <Tag tone={relation.level === "requirement_design" ? "blue" : "purple"}>
                      {levelLabel(relation.level)}
                    </Tag>
                  </td>
                  <td>
                    <div className="cell-title">{relation.sourceName}</div>
                    <div className="cell-sub">{relation.sourceCode}</div>
                  </td>
                  <td>
                    <Tag tone={STATUS_TONE[relation.status] as "green" | "amber" | "red" | "gray" | "purple"}>
                      {STATUS_LABEL[relation.status]}
                    </Tag>
                  </td>
                  <td className="mono">{percent(relation.confidence * 100)}</td>
                  <td>{relation.targetNames.join("；") || "—"}</td>
                  <td className="rationale-cell">{relation.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="report-footer">
          <span>
            报告由一致性评价 Agent 生成 · 判定条目 {item.relations.length} 条 · 评价方法{" "}
            {item.method === "llm" ? "LLM 辅助" : "启发式规则"}
          </span>
          <Link to={`/projects/${projectId}/evaluation?campaign=${item.id}`}>返回任务详情</Link>
        </div>
      </Card>
    </>
  );
}

function IssueCard({ relation }: { relation: Relation }) {
  return (
    <div className={`issue-card issue-${relation.severity.toLowerCase()}`}>
      <div className="issue-head">
        <span className={`severity severity-${relation.severity.toLowerCase()}`}>{relation.severity}</span>
        <Tag tone={STATUS_TONE[relation.status] as "green" | "amber" | "red" | "gray" | "purple"}>
          {STATUS_LABEL[relation.status]}
        </Tag>
        <strong>{relation.sourceName}</strong>
        <span className="muted small">
          {relation.sourceCode} · {relation.sourceType} · {relation.sourceSubsystem}
        </span>
        <span className="muted small">置信度 {percent(relation.confidence * 100)}</span>
      </div>
      <p className="issue-rationale">{relation.rationale}</p>
      {relation.gaps.length > 0 && (
        <div className="issue-gaps">
          <span>缺口：</span>
          {relation.gaps.join("；")}
        </div>
      )}
      {relation.suggestions && <div className="issue-suggestion">建议：{relation.suggestions}</div>}
      {relation.targetNames.length > 0 && <div className="issue-targets">关联：{relation.targetNames.join("；")}</div>}
    </div>
  );
}
