/**
 * 一致性评价页面。
 *
 * 创建任务、轮询进度、展示得分/覆盖率、逐条关系、义务覆盖矩阵、设计悬浮详情和人工审核。
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, formatDate, percent } from "../api";
import { useInterval, useResource } from "../hooks";
import {
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  ProgressBar,
  ScoreRing,
  Spinner,
  StatusPill,
  Tag,
} from "../components/ui";
import { IconAlert, IconCheck, IconLink, IconPlay, IconX } from "../components/Icons";
import { levelLabel, unitLocator } from "../utils";
import type { Campaign, CampaignSummary, DesignUnit, Relation, RelationStatus } from "../types";
import { STATUS_LABEL, STATUS_TONE } from "../types";

/**
 * 一致性评价页面入口。
 *
 * 负责任务创建、进度轮询、汇总、关系列表、义务覆盖详情和设计悬浮对比。
 */
export function EvaluationPage() {
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const project = useResource(() => api.getProject(projectId), [projectId]);
  const designDoc = useResource(() => api.getDocument(projectId, "sdd"), [projectId]);
  const snapshot = useResource(
    () => api.listSnapshots(projectId).then((list) => list.find((item) => item.status === "ready")),
    [projectId],
  );
  const campaigns = useResource(() => api.listCampaigns(projectId), [projectId]);

  const [campaignId, setCampaignId] = useState<string | null>(searchParams.get("campaign"));
  const campaign = useResource(
    () => (campaignId ? api.getCampaign(projectId, campaignId) : Promise.resolve(null)),
    [projectId, campaignId],
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [levels, setLevels] = useState<Array<"requirement_design" | "design_code">>([
    "requirement_design",
    "design_code",
  ]);
  const [subsystems, setSubsystems] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [subsystemFilter, setSubsystemFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [peekDesignCode, setPeekDesignCode] = useState<string | null>(searchParams.get("peek"));
  const focus = searchParams.get("focus");

  const requirementTotal = project.data?.requirementDoc?.total ?? 0;
  const designTotal = project.data?.designDoc?.total ?? 0;
  const hasRd = Boolean(requirementTotal && designTotal);
  const hasDc = Boolean(designTotal && snapshot.data);

  useEffect(() => {
    if (!campaignId && campaigns.data?.length) setCampaignId(campaigns.data[0].id);
  }, [campaignId, campaigns.data]);

  useEffect(() => {
    const next: Array<"requirement_design" | "design_code"> = [];
    if (hasRd) next.push("requirement_design");
    if (hasDc) next.push("design_code");
    setLevels(next);
  }, [hasRd, hasDc]);

  const running = campaign.data?.status === "running" || campaign.data?.status === "queued";
  useInterval(
    async () => {
      if (!campaignId) return;
      try {
        const live = await api.getCampaignStatus(projectId, campaignId);
        campaign.setData(live);
        if (live.status === "completed" || live.status === "failed" || live.status === "cancelled") {
          campaign.reload();
          campaigns.reload();
          project.reload();
        }
      } catch {
        /* keep polling */
      }
    },
    running ? 1500 : null,
  );

  useEffect(() => {
    if (campaignId) {
      const next = new URLSearchParams(searchParams);
      next.set("campaign", campaignId);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const availableSubsystems = useMemo(() => {
    const set = new Set<string>();
    for (const key of Object.keys(project.data?.requirementStats.bySubsystem ?? {})) set.add(key);
    for (const key of Object.keys(project.data?.designStats.bySubsystem ?? {})) set.add(key);
    return [...set];
  }, [project.data]);

  async function createCampaign() {
    if (!levels.length) {
      setError("请至少选择一种评价层级");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const created = await api.createCampaign(projectId, { name: name.trim(), levels, subsystems });
      setName("");
      setCampaignId(created.id);
      campaigns.reload();
      campaign.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function review(relation: Relation, reviewStatus: "accepted" | "pending" | "rejected") {
    if (!campaignId) return;
    setReviewing(true);
    try {
      await api.reviewRelation(projectId, campaignId, relation.id, reviewStatus);
      campaign.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  async function cancel() {
    if (!campaignId) return;
    await api.cancelCampaign(projectId, campaignId);
    campaign.reload();
    campaigns.reload();
  }

  const relations = campaign.data?.relations ?? [];
  const filteredRelations = relations.filter((relation) => {
    if (levelFilter !== "全部" && relation.level !== levelFilter) return false;
    if (statusFilter !== "全部" && relation.status !== statusFilter) return false;
    if (subsystemFilter !== "全部" && relation.sourceSubsystem !== subsystemFilter) return false;
    if (focus && relation.sourceCode !== focus && !relation.targetCodes.includes(focus) && !relation.targetNames.some((n) => n.includes(focus))) return false;
    if (search) {
      const keyword = search.toLowerCase();
      const haystack = `${relation.sourceCode} ${relation.sourceName} ${relation.targetNames.join(" ")} ${relation.rationale} ${relation.evidence}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
  const selectedRelation = relations.find((relation) => relation.id === selectedRelationId) ?? filteredRelations[0];
  const peekDesign = peekDesignCode
    ? designDoc.data?.designUnits.find((unit) => unit.code === peekDesignCode)
    : undefined;

  return (
    <>
      <PageHeader title="一致性评价" subtitle="需求 → 设计 → 代码，LLM 判定与规则匹配双通道" />

      {error && <Notice tone="red">{error}</Notice>}

      <div className="evaluation-top">
        <Card label="NEW CAMPAIGN" title="创建评价" className="create-card">
          <div className="availability">
            <span className={requirementTotal ? "ok" : ""}>
              <IconCheck size={14} /> 需求 {requirementTotal} 条
            </span>
            <span className={designTotal ? "ok" : ""}>
              <IconCheck size={14} /> 设计 {designTotal} 个单元
            </span>
            <span className={snapshot.data ? "ok" : ""}>
              <IconCheck size={14} /> 代码快照 {snapshot.data ? `${snapshot.data.stats.files} 文件` : "未登记"}
            </span>
          </div>
          <div className="form-row">
            <label className="field field-grow">
              <span>任务名称（可选）</span>
              <input value={name} placeholder="例如：V2.7.3 设计评审" onChange={(event) => setName(event.target.value)} />
            </label>
          </div>
          <div className="level-options">
            <label className={`level-option ${!hasRd ? "disabled" : ""}`}>
              <input
                type="checkbox"
                checked={levels.includes("requirement_design")}
                disabled={!hasRd}
                onChange={(event) =>
                  setLevels((current) =>
                    event.target.checked
                      ? [...new Set([...current, "requirement_design" as const])]
                      : current.filter((level) => level !== "requirement_design"),
                  )
                }
              />
              <span>
                <strong>需求 → 设计</strong>
                <small>检查设计是否覆盖需求义务</small>
              </span>
            </label>
            <label className={`level-option ${!hasDc ? "disabled" : ""}`}>
              <input
                type="checkbox"
                checked={levels.includes("design_code")}
                disabled={!hasDc}
                onChange={(event) =>
                  setLevels((current) =>
                    event.target.checked
                      ? [...new Set([...current, "design_code" as const])]
                      : current.filter((level) => level !== "design_code"),
                  )
                }
              />
              <span>
                <strong>设计 → 代码</strong>
                <small>检查代码是否实现设计义务</small>
              </span>
            </label>
          </div>
          {availableSubsystems.length > 0 && (
            <div className="subsystem-select">
              <span className="muted small">范围（不选表示全部）</span>
              <div className="chips">
                {availableSubsystems.map((item) => (
                  <button
                    key={item}
                    className={`chip ${subsystems.includes(item) ? "active" : ""}`}
                    onClick={() =>
                      setSubsystems((current) =>
                        current.includes(item) ? current.filter((value) => value !== item) : [...current, item],
                      )
                    }
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="form-actions">
            <Button variant="primary" icon={<IconPlay size={15} />} onClick={createCampaign} disabled={creating || running || !levels.length}>
              {creating ? "创建中…" : running ? "已有任务运行中" : "创建并开始评价"}
            </Button>
            <span className="hint">未配置 LLM 时自动使用启发式规则；结果仅供参考。</span>
          </div>
        </Card>

        <Card label="HISTORY" title="评价任务" className="history-card">
          {campaigns.data?.length ? (
            <div className="campaign-chips">
              {campaigns.data.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  className={`campaign-chip ${item.id === campaignId ? "active" : ""}`}
                  onClick={() => setCampaignId(item.id)}
                >
                  <span className="campaign-chip-name">{item.name}</span>
                  <span className="campaign-chip-meta">
                    <StatusPill status={item.status} />
                    {typeof item.summary?.score === "number" && <strong>{item.summary.score.toFixed(1)}</strong>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState compact title="还没有评价任务" description="完成文档上传与代码快照登记后创建任务。" />
          )}
        </Card>
      </div>

      {campaign.data ? (
        <>
          {running && (
            <Card label="PROGRESS" title="正在评价">
              <div className="progress-head">
                <Spinner size={16} />
                <span>{campaign.data.progress.message || "准备中…"}</span>
                <span className="muted">
                  {campaign.data.progress.done} / {campaign.data.progress.total}
                </span>
                <div className="progress-spacer" />
                <Button variant="ghost" size="sm" onClick={cancel}>
                  取消任务
                </Button>
              </div>
              <ProgressBar
                value={
                  campaign.data.progress.total > 0
                    ? (campaign.data.progress.done / campaign.data.progress.total) * 100
                    : 5
                }
              />
              <p className="muted small">
                当前阶段：{campaign.data.phase === "requirement_design" ? "需求→设计" : campaign.data.phase === "design_code" ? "设计→代码" : campaign.data.phase === "summary" ? "汇总" : "准备"}
                · 模型：{campaign.data.model || "—"}
              </p>
            </Card>
          )}

          {campaign.data.summary ? (
            <CampaignSummaryView
              summary={campaign.data.summary}
              campaign={campaign.data}
              projectId={projectId}
            />
          ) : (
            !running && <Notice tone="red">{campaign.data.error ?? "任务未完成，暂无汇总。"}</Notice>
          )}

          {campaign.data.warnings?.length ? (
            <Notice tone="amber">
              {campaign.data.warnings.map((warning, index) => (
                <div key={index}>{warning}</div>
              ))}
            </Notice>
          ) : null}

          <Card
            label="RELATIONS"
            title="一致性判定明细"
            actions={
              <Link className="btn btn-secondary btn-sm" to={`/projects/${projectId}/reports/${campaign.data.id}`}>
                查看完整报告
              </Link>
            }
          >
            <div className="relation-filters">
              <label className="filter">
                <span>层级</span>
                <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                  <option>全部</option>
                  <option value="requirement_design">需求 → 设计</option>
                  <option value="design_code">设计 → 代码</option>
                </select>
              </label>
              <label className="filter">
                <span>状态</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option>全部</option>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter">
                <span>子系统</span>
                <select value={subsystemFilter} onChange={(event) => setSubsystemFilter(event.target.value)}>
                  <option>全部</option>
                  {availableSubsystems.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <input className="filter-input" placeholder="搜索来源/目标…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <span className="muted small">{filteredRelations.length} 条</span>
              {focus && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("focus");
                    setSearchParams(next, { replace: true });
                  }}
                >
                  清除聚焦：{focus}
                </Button>
              )}
            </div>

            <div className="relation-layout">
              <div className="table-wrap relation-table-wrap">
                <table className="data-table relation-table">
                  <thead>
                    <tr>
                      <th>层级</th>
                      <th>来源</th>
                      <th>状态</th>
                      <th>置信度</th>
                      <th>目标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRelations.map((relation) => (
                      <tr
                        key={relation.id}
                        className={selectedRelation?.id === relation.id ? "selected" : ""}
                        onClick={() => setSelectedRelationId(relation.id)}
                      >
                        <td>
                          <Tag tone={relation.level === "requirement_design" ? "blue" : "purple"}>
                            {levelLabel(relation.level)}
                          </Tag>
                        </td>
                        <td>
                          <div className="cell-title">{relation.sourceName}</div>
                          <div className="cell-sub">
                            {relation.sourceCode} · {relation.sourceSubsystem}
                          </div>
                        </td>
                        <td>
                          <Tag tone={STATUS_TONE[relation.status] as "green" | "amber" | "red" | "gray" | "purple"}>
                            {STATUS_LABEL[relation.status]}
                          </Tag>
                        </td>
                        <td className="mono">{percent(relation.confidence * 100)}</td>
                        <td>
                          <div className="cell-title">{relation.targetNames[0] ?? "—"}</div>
                          {relation.targetNames.length > 1 && (
                            <div className="cell-sub">等 {relation.targetNames.length} 个</div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!filteredRelations.length && (
                      <tr>
                        <td colSpan={5} className="muted center">
                          没有匹配的判定条目
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {selectedRelation && (
                <RelationDetail
                  relation={selectedRelation}
                  reviewing={reviewing}
                  onReview={review}
                  onOpenDesign={setPeekDesignCode}
                />
              )}
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<IconLink size={30} />}
            title="还没有选中评价任务"
            description="创建任务后，这里会展示一致性得分、覆盖率、问题清单与逐条判定。"
          />
        </Card>
      )}

      {peekDesignCode && (
        <DesignPeek
          code={peekDesignCode}
          unit={peekDesign}
          loading={designDoc.loading}
          error={designDoc.error}
          onClose={() => setPeekDesignCode(null)}
        />
      )}
    </>
  );
}

/**
 * 左侧设计单元悬浮对比窗。
 *
 * 展示设计描述、义务、接口、字段和来源，便于与右侧判定对照。
 */
function DesignPeek({
  code,
  unit,
  loading,
  error,
  onClose,
}: {
  code: string;
  unit?: DesignUnit;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  return (
    <aside className="design-peek" aria-label={`设计单元 ${code}`}>
      <div className="design-peek-head">
        <div>
          <div className="section-label">设计单元对比</div>
          <h3>{unit?.name ?? code}</h3>
          <div className="muted small">
            {code}
            {unit ? ` · ${unit.type} · ${unit.subsystem}` : ""}
          </div>
        </div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭设计单元对比">
          <IconX size={18} />
        </button>
      </div>

      <div className="design-peek-body">
        {loading && <Spinner label="加载设计单元…" />}
        {!loading && (error || !unit) && (
          <Notice tone="amber">
            {error || `未找到设计单元 ${code}，可能已重新拆分。`}
          </Notice>
        )}

        {unit && (
          <>
            <div className="design-peek-tags">
              <Tag tone="blue">{unit.type}</Tag>
              <Tag tone="gray">{unit.subsystem}</Tag>
              <span className="muted small">置信度 {percent(unit.confidence * 100)}</span>
            </div>

            <div className="detail-section">
              <div className="section-label">设计描述</div>
              <div className="quote-block">{unit.description}</div>
            </div>

            {unit.summary && (
              <div className="detail-section">
                <div className="section-label">设计摘要</div>
                <p className="paragraph">{unit.summary}</p>
              </div>
            )}

            <div className="detail-section">
              <div className="section-label">设计义务 ({unit.obligations.length})</div>
              <ol className="obligations">
                {unit.obligations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
                {!unit.obligations.length && <li className="muted">暂无设计义务。</li>}
              </ol>
            </div>

            {unit.interfaceText && (
              <div className="detail-section">
                <div className="section-label">接口</div>
                <pre className="code-block">{unit.interfaceText}</pre>
              </div>
            )}

            {(unit.input || unit.output) && (
              <div className="io-grid">
                <div>
                  <div className="section-label">输入</div>
                  <p className="paragraph small">{unit.input || "—"}</p>
                </div>
                <div>
                  <div className="section-label">输出</div>
                  <p className="paragraph small">{unit.output || "—"}</p>
                </div>
              </div>
            )}

            {unit.fields.length > 0 && (
              <div className="detail-section">
                <div className="section-label">字段 ({unit.fields.length})</div>
                <div className="table-wrap">
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>字段</th>
                        <th>含义</th>
                        <th>类型</th>
                        <th>主键</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unit.fields.map((field) => (
                        <tr key={field.name}>
                          <td className="mono">{field.name}</td>
                          <td>{field.meaning}</td>
                          <td>{field.type}</td>
                          <td>{field.primaryKey ? "√" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="meta-grid">
              <MetaItem label="来源章节（仅追溯）" value={unit.chapter} wide />
              <MetaItem label="源文档 ID" value={unit.sourceId || "—"} muted={!unit.sourceId} />
              <MetaItem
                label="定位"
                value={unit.location.page ? `${unitLocator(unit)}（按渲染分页估算）` : "手工添加"}
              />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function MetaItem({
  label,
  value,
  muted,
  wide,
}: {
  label: string;
  value: string;
  muted?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`meta-item ${wide ? "wide" : ""}`}>
      <span className="meta-label">{label}</span>
      <span className={`meta-value ${muted ? "muted" : ""}`}>{value}</span>
    </div>
  );
}

function CampaignSummaryView({
  summary,
  campaign,
  projectId,
}: {
  summary: CampaignSummary;
  campaign: Campaign;
  projectId: string;
}) {
  const gateLabel = summary.gate === "pass" ? "门禁通过" : summary.gate === "warn" ? "门禁警告" : "门禁不通过";
  return (
    <Card label="SUMMARY" title="评价总览">
      <div className="summary-layout">
        <div className="summary-score">
          <ScoreRing score={summary.score} />
          <div className="summary-tags">
            <Tag tone={summary.gate === "pass" ? "green" : summary.gate === "warn" ? "amber" : "red"}>{gateLabel}</Tag>
            <Tag tone={campaign.method === "llm" ? "blue" : "gray"}>
              {campaign.method === "llm" ? `LLM · ${campaign.model}` : "启发式规则"}
            </Tag>
            <Tag tone="gray">{formatDate(campaign.finishedAt ?? campaign.createdAt)}</Tag>
          </div>
        </div>
        <div className="summary-metrics">
          <div className="metric">
            <div className="metric-label">需求覆盖率</div>
            <div className="metric-value">{percent(summary.requirementCoverage)}</div>
            <ProgressBar value={summary.requirementCoverage} tone="green" />
          </div>
          <div className="metric">
            <div className="metric-label">设计实现覆盖率</div>
            <div className="metric-value">{percent(summary.designCoverage)}</div>
            <ProgressBar value={summary.designCoverage} tone="blue" />
          </div>
          <div className="metric">
            <div className="metric-label">设计被需求追溯</div>
            <div className="metric-value">
              {summary.designCovered} / {summary.designTotal}
            </div>
            <ProgressBar
              value={summary.designTotal ? (summary.designCovered / summary.designTotal) * 100 : 0}
              tone="amber"
            />
          </div>
        </div>
      </div>

      <div className="count-grid">
        <div className="count-cell">
          <span className="dot dot-green" />
          <strong>{summary.counts.satisfied}</strong>
          <span>已覆盖</span>
        </div>
        <div className="count-cell">
          <span className="dot dot-amber" />
          <strong>{summary.counts.partial}</strong>
          <span>部分覆盖</span>
        </div>
        <div className="count-cell">
          <span className="dot dot-red" />
          <strong>{summary.counts.missing}</strong>
          <span>缺失</span>
        </div>
        <div className="count-cell">
          <span className="dot dot-red" />
          <strong>{summary.counts.mismatch + summary.counts.divergent}</strong>
          <span>不一致 / 偏离</span>
        </div>
        <div className="count-cell">
          <span className="dot dot-purple" />
          <strong>{summary.findings.p0}</strong>
          <span>P0 问题</span>
        </div>
        <div className="count-cell">
          <span className="dot dot-gray" />
          <strong>{summary.findings.p1}</strong>
          <span>P1 问题</span>
        </div>
        <div className="summary-link">
          <Link className="btn btn-secondary btn-sm" to={`/projects/${projectId}/reports/${campaign.id}`}>
            生成报告
          </Link>
        </div>
      </div>

      {summary.bySubsystem.length > 0 && (
        <div className="bucket-grid">
          {summary.bySubsystem.map((bucket) => (
            <div key={bucket.key} className="bucket">
              <div className="bucket-head">
                <span>{bucket.key}</span>
                <strong>{bucket.score.toFixed(1)}</strong>
              </div>
              <ProgressBar
                value={bucket.score}
                tone={bucket.score >= 85 ? "green" : bucket.score >= 70 ? "amber" : "red"}
              />
              <div className="bucket-meta">
                {bucket.total} 条 · 缺 {bucket.missing}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const COVERAGE_META = {
  covered: { label: "已覆盖", tone: "green" },
  partial: { label: "部分覆盖", tone: "amber" },
  conflicting: { label: "冲突", tone: "red" },
  missing: { label: "未覆盖", tone: "gray" },
} as const;

/**
 * 需求→设计或设计→代码关系详情。
 *
 * 展示状态、覆盖率、义务矩阵、证据、缺口、目标链接和人工审核。
 */
function RelationDetail({
  relation,
  reviewing,
  onReview,
  onOpenDesign,
}: {
  relation: Relation;
  reviewing: boolean;
  onReview: (relation: Relation, status: "accepted" | "pending" | "rejected") => void;
  onOpenDesign: (code: string) => void;
}) {
  return (
    <div className="relation-detail">
      <div className="relation-detail-head">
        <Tag tone={STATUS_TONE[relation.status] as "green" | "amber" | "red" | "gray" | "purple"}>
          {STATUS_LABEL[relation.status]}
        </Tag>
        <span className={`severity severity-${relation.severity.toLowerCase()}`}>{relation.severity === "none" ? "无风险" : relation.severity}</span>
        <span className="muted small">
          {relation.obligations?.length ? "覆盖置信度" : "置信度"} {percent(relation.confidence * 100)}
        </span>
        <span className="muted small">· {relation.method === "llm" ? "LLM" : "规则"}</span>
      </div>
      {typeof relation.coverageRatio === "number" && (
        <div className="coverage-banner">
          <strong>联合覆盖 {percent(relation.coverageRatio * 100)}</strong>
          <span className="muted small">
            {relation.obligations?.filter((item) => item.status === "covered").length ?? 0}/
            {relation.obligations?.length ?? 0} 条义务被完整覆盖
          </span>
        </div>
      )}
      <h3 className="relation-source">{relation.sourceName}</h3>
      <div className="muted small">
        {relation.sourceCode} · {relation.sourceType} · {relation.sourceSubsystem}
      </div>

      <div className="detail-section">
        <div className="section-label">判定说明</div>
        <p className="paragraph">{relation.rationale}</p>
      </div>

      {relation.evidence && (
        <div className="detail-section">
          <div className="section-label">证据</div>
          <div className="quote-block secondary small">{relation.evidence}</div>
        </div>
      )}

      {relation.obligations && relation.obligations.length > 0 && (
        <div className="detail-section">
          <div className="section-label">原子义务覆盖（多设计联合）</div>
          <div className="coverage-list">
            {relation.obligations.map((obligation) => {
              const meta = COVERAGE_META[obligation.status];
              return (
                <div key={obligation.id} className={`coverage-row coverage-${obligation.status}`}>
                  <Tag tone={meta.tone}>{meta.label}</Tag>
                  <div className="coverage-content">
                    <div className="coverage-text">
                      <span className="coverage-id">{obligation.id}</span>
                      {obligation.text}
                    </div>
                    <div className="muted small">
                      {obligation.coveredBy.length ? `覆盖设计：${obligation.coveredBy.join("、")}` : "无设计覆盖"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {relation.gaps.length > 0 && (
        <div className="detail-section">
          <div className="section-label">缺口</div>
          <ul className="gap-list">
            {relation.gaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {relation.suggestions && (
        <div className="detail-section">
          <div className="section-label">建议</div>
          <p className="paragraph">{relation.suggestions}</p>
        </div>
      )}

      <div className="detail-section">
        <div className="section-label">关联目标</div>
        {relation.targetNames.length ? (
          <>
            {relation.level === "requirement_design" && (
              <p className="muted small">点击设计单元可在左侧悬浮窗中对比查看。</p>
            )}
            <div className="chips">
              {relation.targetNames.map((target, index) => {
                const targetCode = relation.targetCodes[index];
                const coverage = relation.targetCoverages?.find((item) => item.targetCode === targetCode);
                if (relation.level === "requirement_design" && targetCode) {
                  return (
                    <button
                      key={targetCode}
                      type="button"
                      className="chip chip-link"
                      onClick={() => onOpenDesign(targetCode)}
                      title={`对比查看设计单元 ${targetCode}`}
                    >
                      <span>{target}</span>
                      <span className="chip-code">{targetCode}</span>
                      {coverage && (
                        <span className="chip-coverage">
                          覆盖 {Math.round(coverage.contributionRatio * 100)}%
                        </span>
                      )}
                    </button>
                  );
                }
                return (
                  <span key={`${target}-${index}`} className="chip chip-static">
                    {target}
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <span className="muted small">未匹配到目标，需补充设计/实现。</span>
        )}
      </div>

      <div className="review-actions">
        <Button
          variant="soft"
          size="sm"
          icon={<IconCheck size={14} />}
          disabled={reviewing}
          onClick={() => onReview(relation, "accepted")}
        >
          确认判定
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconX size={14} />}
          disabled={reviewing}
          onClick={() => onReview(relation, "rejected")}
        >
          驳回
        </Button>
        {relation.reviewStatus !== "pending" && (
          <Button variant="ghost" size="sm" onClick={() => onReview(relation, "pending")}>
            重置
          </Button>
        )}
        <span className="muted small">
          审核状态：
          {relation.reviewStatus === "accepted" ? "已确认" : relation.reviewStatus === "rejected" ? "已驳回（不计分）" : "待审核"}
        </span>
      </div>
    </div>
  );
}
