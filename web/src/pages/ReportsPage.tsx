/**
 * 评价报告列表页。
 *
 * 按项目列出已完成评价和报告入口。
 */

import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatDate, percent } from "../api";
import { useResource } from "../hooks";
import { Button, Card, EmptyState, PageHeader, ProgressBar, Tag } from "../components/ui";
import { IconReport } from "../components/Icons";
import { levelLabel } from "../utils";
import type { Campaign } from "../types";

/**
 * 报告列表页面入口。
 *
 * 列出已完成评价并提供报告详情入口。
 */
export function ReportsPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const project = useResource(() => api.getProject(projectId), [projectId], { key: "project" });
  const campaigns = useResource(() => api.listCampaigns(projectId), [projectId], { key: "campaigns" });

  return (
    <>
      <PageHeader title="评价报告" subtitle="报告与门禁：汇总一致性得分、覆盖率与问题清单" />

      <Card label="REPORTS" title={`${project.data?.name ?? ""} 的评价报告`}>
        {campaigns.data?.length ? (
          <div className="report-grid">
            {campaigns.data.map((campaign) => (
              <ReportCard
                key={campaign.id}
                campaign={campaign}
                projectId={projectId}
                onOpen={() =>
                  campaign.status === "completed"
                    ? navigate(`/projects/${projectId}/reports/${campaign.id}`)
                    : navigate(`/projects/${projectId}/evaluation?campaign=${campaign.id}`)
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconReport size={30} />}
            title="还没有评价报告"
            description="创建并完成一次一致性评价后，这里会生成可导出的报告与门禁结论。"
            actions={
              <Button variant="primary" size="sm" onClick={() => navigate(`/projects/${projectId}/evaluation`)}>
                去创建评价
              </Button>
            }
          />
        )}
      </Card>

      <Card label="GATE" title="门禁规则">
        <div className="gate-grid">
          <div className="gate-item gate-pass">
            <strong>≥ 85</strong>
            <span>通过</span>
            <p>关键需求与设计全部有据可查，允许进入下一阶段。</p>
          </div>
          <div className="gate-item gate-warn">
            <strong>70 – 85</strong>
            <span>警告</span>
            <p>存在部分覆盖或低置信度判定，建议评审确认后放行。</p>
          </div>
          <div className="gate-item gate-fail">
            <strong>&lt; 70</strong>
            <span>不通过</span>
            <p>存在关键缺失或不一致，需补齐设计/实现后重新评价。</p>
          </div>
        </div>
        <p className="muted small">
          门禁得分按判定状态加权：已覆盖 100、部分覆盖 60、偏离 30、不一致 20、缺失 0；被驳回的条目不计入。
        </p>
      </Card>
    </>
  );
}

function ReportCard({
  campaign,
  projectId,
  onOpen,
}: {
  campaign: Campaign;
  projectId: string;
  onOpen: () => void;
}) {
  const summary = campaign.summary;
  const gate = summary?.gate ?? "warn";
  return (
    <div className="report-card">
      <div className="report-card-top">
        <div>
          <div className="report-card-name">{campaign.name}</div>
          <div className="muted small">
            {formatDate(campaign.finishedAt ?? campaign.createdAt)} · {campaign.method === "llm" ? campaign.model : "规则匹配"}
          </div>
        </div>
        <Tag tone={gate === "pass" ? "green" : gate === "warn" ? "amber" : "red"}>
          {gate === "pass" ? "通过" : gate === "warn" ? "警告" : "不通过"}
        </Tag>
      </div>
      <div className="report-card-score">
        <strong>{summary ? summary.score.toFixed(1) : "—"}</strong>
        <span>/ 100</span>
      </div>
      <div className="report-card-bars">
        <div>
          <span>需求覆盖率</span>
          <ProgressBar value={summary?.requirementCoverage ?? 0} tone="green" />
          <em>{summary ? percent(summary.requirementCoverage) : "—"}</em>
        </div>
        <div>
          <span>设计实现覆盖率</span>
          <ProgressBar value={summary?.designCoverage ?? 0} tone="blue" />
          <em>{summary ? percent(summary.designCoverage) : "—"}</em>
        </div>
      </div>
      <div className="report-card-meta">
        {campaign.levels.map((level) => (
          <Tag key={level} tone="blue">
            {levelLabel(level)}
          </Tag>
        ))}
        <span>{summary ? `${summary.counts.total} 条判定` : campaign.status}</span>
      </div>
      <div className="report-card-actions">
        <button className="btn btn-secondary btn-sm" onClick={onOpen}>
          {campaign.status === "completed" ? "查看报告" : "查看任务"}
        </button>
        {campaign.status === "completed" && (
          <>
            <a className="btn btn-ghost btn-sm" href={api.exportReportUrl(projectId, campaign.id, "md")} target="_blank" rel="noreferrer">
              导出 MD
            </a>
            <a className="btn btn-ghost btn-sm" href={api.exportReportUrl(projectId, campaign.id, "csv")} target="_blank" rel="noreferrer">
              导出 CSV
            </a>
          </>
        )}
      </div>
    </div>
  );
}
