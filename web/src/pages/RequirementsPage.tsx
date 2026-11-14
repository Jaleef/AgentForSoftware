/**
 * 需求结构页面。
 *
 * 展示需求单元树/详情、义务、来源、审核，并支持手工新增/删除需求单元。
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, percent } from "../api";
import { useDebounced, useInterval, useResource } from "../hooks";
import {
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  Tag,
} from "../components/ui";
import { IconFile, IconLink, IconPlus, IconSearch, IconTrash, IconX } from "../components/Icons";
import { groupBySubsystem, requirementTone, unitLocator } from "../utils";
import type { RequirementType, RequirementUnit } from "../types";
import { REQUIREMENT_TYPES } from "../types";

interface ManualRequirementDraft {
  type: RequirementType;
  subsystem: string;
  title: string;
  description: string;
  detail: string;
  obligations: string;
  sourceId: string;
}

const emptyManualDraft: ManualRequirementDraft = {
  type: "功能需求",
  subsystem: "全局",
  title: "",
  description: "",
  detail: "",
  obligations: "",
  sourceId: "",
};

/**
 * 需求结构页面入口。
 *
 * 负责筛选、分组树、详情审核、手工新增/删除和 LLM 整理轮询。
 */
export function RequirementsPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const resource = useResource(() => api.getDocument(projectId, "srs"), [projectId], {
    key: "document-srs",
  });
  const doc = resource.data;

  const [origin, setOrigin] = useState("全部");
  const [subsystem, setSubsystem] = useState("全部");
  const [type, setType] = useState("全部");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [reviewType, setReviewType] = useState<RequirementType>("功能需求");
  const [reviewNote, setReviewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<ManualRequirementDraft>(emptyManualDraft);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const units = doc?.requirements ?? [];
  const selected = units.find((unit) => unit.code === selectedCode) ?? units[0];

  useEffect(() => {
    if (!selectedCode && units.length) setSelectedCode(units[0].code);
  }, [units, selectedCode]);

  useEffect(() => {
    if (selected) {
      setReviewType(selected.type);
      setReviewNote(selected.reviewNote ?? "");
    }
  }, [selected?.code]);

  useInterval(
    () => {
      resource.reload();
    },
    doc?.status === "enriching" ? 2500 : null,
  );

  const systems = useMemo(() => Object.keys(doc?.stats.bySubsystem ?? {}), [doc]);
  const types = useMemo(() => Object.keys(doc?.stats.byType ?? {}), [doc]);

  const filtered = useMemo(() => {
    const keyword = debouncedSearch.trim().toLowerCase();
    return units.filter((unit) => {
      if (origin !== "全部" && unit.origin !== origin) return false;
      if (subsystem !== "全部" && unit.subsystem !== subsystem) return false;
      if (type !== "全部" && unit.type !== type) return false;
      if (keyword) {
        const haystack = `${unit.code} ${unit.title} ${unit.description} ${unit.detail} ${unit.chapter}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [units, origin, subsystem, type, debouncedSearch]);

  const groups = useMemo(() => groupBySubsystem(filtered), [filtered]);

  async function saveReview() {
    if (!selected) return;
    setSaving(true);
    setNotice("");
    try {
      await api.patchRequirement(projectId, selected.code, {
        type: reviewType,
        reviewNote,
        reviewStatus: "confirmed",
      });
      setNotice("需求类型与审核备注已保存。");
      resource.reload();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openAdd() {
    setDraft({ ...emptyManualDraft, subsystem: systems[0] ?? "全局" });
    setAddError("");
    setShowAdd(true);
  }

  function updateDraft(patch: Partial<ManualRequirementDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function submitAdd() {
    if (!draft.description.trim()) {
      setAddError("需求描述不能为空。");
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      const unit = await api.createRequirement(projectId, {
        type: draft.type,
        title: draft.title.trim() || undefined,
        description: draft.description.trim(),
        detail: draft.detail.trim() || undefined,
        subsystem: draft.subsystem.trim() || "全局",
        obligations: draft.obligations,
        sourceId: draft.sourceId.trim() || undefined,
      });
      setShowAdd(false);
      setNotice(`已添加需求单元 ${unit.code}。`);
      setSelectedCode(unit.code);
      resource.reload();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    if (doc?.status === "enriching") {
      setNotice("文档正在 LLM 整理，请完成后再删除需求单元。");
      return;
    }
    if (!window.confirm(`确定删除需求单元 ${selected.code} 吗？删除后其需求点也会一并移除。`)) return;
    setDeleting(true);
    setNotice("");
    try {
      await api.deleteRequirement(projectId, selected.code);
      setNotice(`已删除需求单元 ${selected.code}。`);
      setSelectedCode(null);
      resource.reload();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (resource.loading && !doc) {
    return (
      <div className="loading-block">
        <Spinner label="加载需求结构…" />
      </div>
    );
  }

  if (!doc) {
    return (
      <>
        <PageHeader title="需求结构" subtitle="需求表规则解析 · 文本章节 LLM 判定 · LLM 生成需求单元" />
        <Card>
          <EmptyState
            icon={<IconFile size={30} />}
            title="尚未上传需求文档"
            description={resource.error ?? "请先在项目页上传 DOCX 需求文档，系统会自动拆分需求单元。"}
            actions={
              <Button variant="primary" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
                去上传
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const sourceIdCount = units.filter((unit) => unit.sourceId).length;

  return (
    <>
      <PageHeader title="需求结构" subtitle="需求表规则解析 · 文本章节 LLM 判定 · LLM 生成需求单元" />

      {doc.status === "enriching" && (
        <Notice tone="blue">
          <Spinner size={14} label="LLM 正在判断文本型需求点，并生成结构化需求单元…完成后自动刷新。" />
        </Notice>
      )}
      {notice && (
        <Notice tone={/失败|错误|不能|不存在/.test(notice) ? "red" : "green"}>{notice}</Notice>
      )}
      {doc.warnings.length > 0 && (
        <Notice tone="amber">
          {doc.warnings.slice(0, 4).map((warning, index) => (
            <div key={index}>{warning}</div>
          ))}
        </Notice>
      )}

      <Card className="stats-card">
        <div className="stats-row">
          <div className="stat headline">
            <div className="stat-value">{units.length}</div>
            <div className="stat-label">需求单元</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{doc.requirementPoints?.length ?? 0}</div>
            <div className="stat-label">需求点（含候选）</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{doc.version}</div>
            <div className="stat-label">文档版本</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{systems.length}</div>
            <div className="stat-label">子系统</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{types.length}</div>
            <div className="stat-label">类型</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{sourceIdCount}</div>
            <div className="stat-label">源文档 ID</div>
          </div>
          <div className="stats-actions">
            <Button
              variant="secondary"
              icon={<IconPlus size={15} />}
              onClick={openAdd}
              disabled={doc.status === "enriching"}
            >
              添加需求单元
            </Button>
            <Button
              variant="primary"
              icon={<IconLink size={15} />}
              onClick={() => navigate(`/projects/${projectId}/evaluation`)}
            >
              去一致性评价
            </Button>
          </div>
        </div>
        <div className="filter-row">
          <label className="filter">
            <span>解析来源</span>
            <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="全部">全部</option>
              <option value="rule">规则解析（需求表）</option>
              <option value="llm">LLM 解析（文本章节）</option>
              <option value="manual">手工添加</option>
            </select>
          </label>
          <label className="filter">
            <span>子系统</span>
            <select value={subsystem} onChange={(event) => setSubsystem(event.target.value)}>
              <option value="全部">全部</option>
              {systems.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>类型</span>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="全部">全部</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className="split-layout">
        <Card
          label="REQUIREMENTS"
          title="需求结构"
          className="list-card"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setCollapsed({})}>
              展开全部
            </Button>
          }
        >
          <div className="search-box">
            <IconSearch size={16} />
            <input
              value={search}
              placeholder="搜索名称、ID、章节或位置…"
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="muted small">{filtered.length} 条</span>
          </div>

          {groups.length ? (
            <div className="group-list">
              {groups.map((group) => {
                const isCollapsed = collapsed[group.subsystem];
                return (
                  <div key={group.subsystem} className="group">
                    <button
                      className="group-head"
                      onClick={() => setCollapsed((state) => ({ ...state, [group.subsystem]: !isCollapsed }))}
                    >
                      <span className={`chevron ${isCollapsed ? "" : "open"}`}>›</span>
                      <span>{group.subsystem}</span>
                      <span className="group-count">{group.items.length}</span>
                      <span className="group-types">
                        {[...new Set(group.items.map((item) => item.type))].slice(0, 3).map((item) => (
                          <Tag key={item} tone={requirementTone(item)}>
                            {item}
                          </Tag>
                        ))}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="group-items">
                        {group.items.map((unit) => (
                          <button
                            key={unit.code}
                            className={`unit-row ${selected?.code === unit.code ? "selected" : ""}`}
                            onClick={() => setSelectedCode(unit.code)}
                          >
                            <span className="unit-title">{unit.title}</span>
                            <span className="unit-side">
                              <span className="unit-code">{unit.code}</span>
                              <span className="unit-type">{unit.type}</span>
                              <span className={`review-dot ${unit.reviewStatus === "confirmed" ? "ok" : ""}`}>
                                {unit.reviewStatus === "confirmed" ? "已审核" : "待审核"}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="没有匹配的需求单元" description="调整筛选条件或搜索关键词后再试。" />
          )}
        </Card>

        <Card className="detail-card">
          {selected ? (
            <RequirementDetail
              unit={selected}
              projectId={projectId}
              reviewType={reviewType}
              reviewNote={reviewNote}
              saving={saving}
              deleting={deleting}
              canDelete={doc.status !== "enriching"}
              onType={setReviewType}
              onNote={setReviewNote}
              onSave={saveReview}
              onDelete={deleteSelected}
            />
          ) : (
            <EmptyState compact title="选择一条需求" description="左侧列表中的需求单元会显示在这里。" />
          )}
        </Card>
      </div>

      {showAdd && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowAdd(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="添加需求单元">
            <div className="modal-head">
              <div>
                <h3>添加需求单元</h3>
                <p className="muted small">手工添加的单元会以 SRS-MAN 编号保存，并在 LLM 重新整理后保留。</p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setShowAdd(false)} aria-label="关闭">
                <IconX size={18} />
              </button>
            </div>
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAdd();
              }}
            >
              <div className="form-grid-2">
                <label className="field">
                  <span>需求类型</span>
                  <select
                    value={draft.type}
                    onChange={(event) => updateDraft({ type: event.target.value as RequirementType })}
                  >
                    {REQUIREMENT_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>子系统</span>
                  <input
                    list="manual-subsystems"
                    value={draft.subsystem}
                    onChange={(event) => updateDraft({ subsystem: event.target.value })}
                    placeholder="例如：数字孪生平台"
                  />
                  <datalist id="manual-subsystems">
                    {systems.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="field">
                <span>标题（可选）</span>
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  placeholder="留空则从需求描述生成"
                />
              </label>

              <label className="field">
                <span>需求描述 *</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  placeholder="输入需求原文或人工整理后的需求描述"
                  autoFocus
                />
              </label>

              <label className="field">
                <span>需求说明（可选）</span>
                <textarea
                  rows={2}
                  value={draft.detail}
                  onChange={(event) => updateDraft({ detail: event.target.value })}
                  placeholder="补充输入、处理规则、约束等"
                />
              </label>

              <label className="field">
                <span>原子义务（可选，每行一条）</span>
                <textarea
                  rows={3}
                  value={draft.obligations}
                  onChange={(event) => updateDraft({ obligations: event.target.value })}
                  placeholder="留空则从需求描述和需求说明自动切分"
                />
              </label>

              <label className="field">
                <span>源文档 ID（可选）</span>
                <input
                  value={draft.sourceId}
                  onChange={(event) => updateDraft({ sourceId: event.target.value })}
                  placeholder="例如：DT_REQ_0099"
                />
              </label>

              {addError && <Notice tone="red">{addError}</Notice>}

              <div className="modal-actions">
                <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>
                  取消
                </Button>
                <Button type="submit" variant="primary" disabled={adding}>
                  {adding ? "添加中…" : "添加需求单元"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * 需求单元详情面板。
 *
 * 展示原文、义务、来源、置信度和审核操作。
 */
function RequirementDetail({
  unit,
  projectId,
  reviewType,
  reviewNote,
  saving,
  deleting,
  canDelete,
  onType,
  onNote,
  onSave,
  onDelete,
}: {
  unit: RequirementUnit;
  projectId: string;
  reviewType: RequirementType;
  reviewNote: string;
  saving: boolean;
  deleting: boolean;
  canDelete: boolean;
  onType: (value: RequirementType) => void;
  onNote: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <div>
          <Tag tone={requirementTone(unit.type)}>{unit.type}</Tag>
          <h2 className="detail-code">{unit.code}</h2>
          <div className="muted small">{unitLocator(unit)}</div>
        </div>
        <span className={`review-pill ${unit.reviewStatus === "confirmed" ? "ok" : ""}`}>
          {unit.reviewStatus === "confirmed" ? "已审核" : "待审核"}
        </span>
      </div>

      <div className="detail-section">
        <div className="section-label">需求原文</div>
        <div className="quote-block">{unit.description}</div>
        {unit.detail && (
          <>
            <div className="section-label">需求说明</div>
            <div className="quote-block secondary">{unit.detail}</div>
          </>
        )}
      </div>

      <div className="detail-section">
        <div className="section-label">原子义务 ({unit.obligations.length})</div>
        <ol className="obligations">
          {unit.obligations.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
          {unit.obligations.length === 0 && <li className="muted">未拆分出原子义务，可重新拆分或人工补充。</li>}
        </ol>
      </div>

      <div className="meta-grid">
        <MetaItem label="系统需求 ID" value={unit.code} />
        <MetaItem label="源文档 ID" value={unit.sourceId || "源文档未填写"} muted={!unit.sourceId} />
        <MetaItem label="父需求 ID" value={unit.parentSourceId || "—"} muted={!unit.parentSourceId} />
        <MetaItem label="子系统" value={unit.subsystem} />
        <MetaItem label="来源章节（仅追溯）" value={unit.chapter} wide />
        <MetaItem
          label="定位"
          value={unit.location.page ? `${unitLocator(unit)}（按渲染分页估算）` : "手工添加"}
        />
        <MetaItem label="置信度" value={percent(unit.confidence * 100)} />
        <MetaItem
          label="解析来源"
          value={
            unit.origin === "manual"
              ? "人工添加"
              : unit.origin === "llm"
                ? "LLM 判定文本需求点"
                : "需求表规则解析"
          }
        />
        <MetaItem
          label="单元生成"
          value={
            unit.structureOrigin === "manual"
              ? "手工添加"
              : unit.structureOrigin === "rule"
                ? "规则回退"
                : unit.structureOrigin === "llm"
                  ? "LLM 生成"
                  : "未记录"
          }
        />
      </div>

      {unit.summary && (
        <div className="detail-section">
          <div className="section-label">摘要</div>
          <p className="paragraph">{unit.summary}</p>
        </div>
      )}

      <div className="review-box">
        <div className="section-label">人工审核需求类型</div>
        <p className="muted small">默认值来自解析结果与 LLM 分类；修改后可保存并作为后续评价依据。</p>
        <select value={reviewType} onChange={(event) => onType(event.target.value as RequirementType)}>
          {REQUIREMENT_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <textarea
          placeholder="审核备注（可选）"
          rows={2}
          value={reviewNote}
          onChange={(event) => onNote(event.target.value)}
        />
        <Button variant="primary" onClick={onSave} disabled={saving}>
          {saving ? "保存中…" : "保存需求类型"}
        </Button>
      </div>

      <div className="detail-actions">
        <Button
          variant="danger"
          icon={<IconTrash size={15} />}
          onClick={onDelete}
          disabled={deleting || !canDelete}
        >
          {deleting ? "删除中…" : canDelete ? "删除需求单元" : "LLM 整理中…"}
        </Button>
        <span className="muted small">删除后会同步移除对应需求点，后续 LLM 整理不会重新生成。</span>
      </div>
    </div>
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
