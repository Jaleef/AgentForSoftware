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
  Segmented,
  Spinner,
  Tag,
} from "../components/ui";
import { IconLayers, IconLink, IconPlus, IconSearch, IconTrash, IconX } from "../components/Icons";
import { designTone, groupBySubsystem, unitLocator } from "../utils";
import type { DesignUnit } from "../types";

const DESIGN_TYPES: DesignUnit["type"][] = ["模块", "子功能", "数据表", "页面"];

interface ManualDesignDraft {
  type: DesignUnit["type"];
  name: string;
  subsystem: string;
  description: string;
  detail: string;
  interfaceText: string;
  input: string;
  output: string;
  obligations: string;
  sourceId: string;
}

const emptyDesignDraft: ManualDesignDraft = {
  type: "模块",
  name: "",
  subsystem: "全局",
  description: "",
  detail: "",
  interfaceText: "",
  input: "",
  output: "",
  obligations: "",
  sourceId: "",
};

export function DesignPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const resource = useResource(() => api.getDocument(projectId, "sdd"), [projectId]);
  const doc = resource.data;

  const [origin, setOrigin] = useState("全部");
  const [subsystem, setSubsystem] = useState("全部");
  const [type, setType] = useState("全部");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "cards">("tree");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<ManualDesignDraft>(emptyDesignDraft);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const units = doc?.designUnits ?? [];
  const selected = units.find((unit) => unit.code === selectedCode) ?? units[0];

  useEffect(() => {
    if (!selectedCode && units.length) setSelectedCode(units[0].code);
  }, [units, selectedCode]);

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
        const haystack = `${unit.code} ${unit.name} ${unit.description} ${unit.interfaceText} ${unit.chapter}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [units, origin, subsystem, type, debouncedSearch]);

  const groups = useMemo(() => groupBySubsystem(filtered), [filtered]);
  const moduleCount = (doc?.stats.byType["模块"] ?? 0) + (doc?.stats.byType["子功能"] ?? 0);

  async function confirmUnit() {
    if (!selected) return;
    setSaving(true);
    setNotice("");
    try {
      await api.patchDesignUnit(projectId, selected.code, { reviewStatus: "confirmed" });
      setNotice("已标记为审核通过。");
      resource.reload();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openAdd() {
    setDraft({ ...emptyDesignDraft, subsystem: systems[0] ?? "全局" });
    setAddError("");
    setShowAdd(true);
  }

  function updateDraft(patch: Partial<ManualDesignDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function submitAdd() {
    if (!draft.name.trim()) {
      setAddError("设计单元名称不能为空。");
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      const unit = await api.createDesignUnit(projectId, {
        type: draft.type,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        detail: draft.detail.trim() || undefined,
        subsystem: draft.subsystem.trim() || "全局",
        interfaceText: draft.interfaceText.trim() || undefined,
        input: draft.input.trim() || undefined,
        output: draft.output.trim() || undefined,
        obligations: draft.obligations,
        sourceId: draft.sourceId.trim() || undefined,
      });
      setShowAdd(false);
      setNotice(`已添加设计单元 ${unit.code}。`);
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
      setNotice("文档正在 LLM 整理，请完成后再删除设计单元。");
      return;
    }
    if (!window.confirm(`确定删除设计单元 ${selected.code} 吗？删除后其设计点也会一并移除。`)) return;
    setDeleting(true);
    setNotice("");
    try {
      await api.deleteDesignUnit(projectId, selected.code);
      setNotice(`已删除设计单元 ${selected.code}。`);
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
        <Spinner label="加载设计结构…" />
      </div>
    );
  }

  if (!doc) {
    return (
      <>
        <PageHeader title="设计结构" subtitle="模块、接口、数据与页面设计" />
        <Card>
          <EmptyState
            icon={<IconLayers size={30} />}
            title="尚未上传设计文档"
            description={resource.error ?? "请先在项目页上传 DOCX 设计文档。"}
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

  return (
    <>
      <PageHeader title="设计结构" subtitle="模块、接口、数据与页面设计" />

      {notice && (
        <Notice tone={/失败|错误|不能|不存在/.test(notice) ? "red" : "green"}>{notice}</Notice>
      )}
      {doc.status === "enriching" && (
        <Notice tone="blue">
          <Spinner size={14} label="LLM 正在判断文本/数据库设计候选，并生成设计单元…完成后自动刷新。" />
        </Notice>
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
            <div className="stat-label">设计单元</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{doc.designPoints?.length ?? 0}</div>
            <div className="stat-label">设计点（含候选）</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{moduleCount}</div>
            <div className="stat-label">模块 / 子功能</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{doc.stats.byType["数据表"] ?? 0}</div>
            <div className="stat-label">数据表</div>
          </div>
          <div className="stat">
            <div className="stat-value small-value">{doc.stats.byType["页面"] ?? 0}</div>
            <div className="stat-label">页面</div>
          </div>
          <div className="stats-actions">
            <Button
              variant="secondary"
              icon={<IconPlus size={15} />}
              onClick={openAdd}
              disabled={doc.status === "enriching"}
            >
              添加设计单元
            </Button>
            <Button variant="primary" icon={<IconLink size={15} />} onClick={() => navigate(`/projects/${projectId}/evaluation`)}>
              去一致性评价
            </Button>
          </div>
        </div>
        <div className="filter-row">
          <label className="filter">
            <span>解析来源</span>
            <select value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="全部">全部</option>
              <option value="rule">规则解析（设计表）</option>
              <option value="llm">LLM 解析（文本/数据表）</option>
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
          <div className="filter-spacer" />
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "tree", label: "树视图" },
              { value: "cards", label: "模块卡片" },
            ]}
          />
        </div>
      </Card>

      <div className="split-layout">
        <Card
          label="DESIGN"
          title={view === "tree" ? "设计结构树" : "设计单元卡片"}
          className="list-card"
          actions={
            view === "tree" ? (
              <Button variant="ghost" size="sm" onClick={() => setCollapsed({})}>
                展开全部
              </Button>
            ) : undefined
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

          {view === "tree" ? (
            groups.length ? (
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
                          {[...new Set(group.items.map((item) => item.type))].slice(0, 4).map((item) => (
                            <Tag key={item} tone={designTone(item)}>
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
                              <span className="unit-bullet">{unit.type === "数据表" ? "▦" : unit.type === "页面" ? "□" : "◆"}</span>
                              <span className="unit-title">{unit.name}</span>
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
              <EmptyState compact title="没有匹配的设计单元" />
            )
          ) : (
            <div className="unit-card-grid">
              {filtered.map((unit) => (
                <button
                  key={unit.code}
                  className={`unit-card ${selected?.code === unit.code ? "selected" : ""}`}
                  onClick={() => setSelectedCode(unit.code)}
                >
                  <div className="unit-card-top">
                    <Tag tone={designTone(unit.type)}>{unit.type}</Tag>
                    <span className="unit-code">{unit.code}</span>
                  </div>
                  <div className="unit-card-title">{unit.name}</div>
                  <div className="unit-card-desc">{unit.summary || unit.description}</div>
                  <div className="unit-card-foot">
                    <span>{unit.subsystem}</span>
                    <span>{unit.obligations.length} 项义务</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="detail-card">
          {selected ? (
            <DesignDetail
              unit={selected}
              projectId={projectId}
              saving={saving}
              deleting={deleting}
              canDelete={doc.status !== "enriching"}
              onConfirm={confirmUnit}
              onDelete={deleteSelected}
            />
          ) : (
            <EmptyState compact title="选择一个设计单元" />
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
          <div className="modal" role="dialog" aria-modal="true" aria-label="添加设计单元">
            <div className="modal-head">
              <div>
                <h3>添加设计单元</h3>
                <p className="muted small">手工添加的单元会以 SDD-MAN 编号保存，并在 LLM 重新整理后保留。</p>
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
                  <span>设计类型</span>
                  <select
                    value={draft.type}
                    onChange={(event) => updateDraft({ type: event.target.value as DesignUnit["type"] })}
                  >
                    {DESIGN_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>子系统</span>
                  <input
                    list="manual-design-subsystems"
                    value={draft.subsystem}
                    onChange={(event) => updateDraft({ subsystem: event.target.value })}
                    placeholder="例如：数字孪生平台"
                  />
                  <datalist id="manual-design-subsystems">
                    {systems.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="field">
                <span>设计单元名称 *</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  placeholder="例如：删除数据库"
                  autoFocus
                />
              </label>

              <label className="field">
                <span>设计描述</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  placeholder="描述模块/接口/数据/页面的设计行为"
                />
              </label>

              <label className="field">
                <span>补充说明（可选）</span>
                <textarea
                  rows={2}
                  value={draft.detail}
                  onChange={(event) => updateDraft({ detail: event.target.value })}
                  placeholder="数据结构、约束、异常处理等"
                />
              </label>

              <label className="field">
                <span>接口（可选）</span>
                <textarea
                  rows={2}
                  value={draft.interfaceText}
                  onChange={(event) => updateDraft({ interfaceText: event.target.value })}
                  placeholder="函数签名、路由或调用方式"
                />
              </label>

              <div className="form-grid-2">
                <label className="field">
                  <span>输入</span>
                  <input
                    value={draft.input}
                    onChange={(event) => updateDraft({ input: event.target.value })}
                    placeholder="例如：数据库名称"
                  />
                </label>
                <label className="field">
                  <span>输出</span>
                  <input
                    value={draft.output}
                    onChange={(event) => updateDraft({ output: event.target.value })}
                    placeholder="例如：删除是否成功"
                  />
                </label>
              </div>

              <label className="field">
                <span>设计义务（可选，每行一条）</span>
                <textarea
                  rows={3}
                  value={draft.obligations}
                  onChange={(event) => updateDraft({ obligations: event.target.value })}
                  placeholder="留空则从设计描述、接口、输入输出自动切分"
                />
              </label>

              <label className="field">
                <span>源文档 ID（可选）</span>
                <input
                  value={draft.sourceId}
                  onChange={(event) => updateDraft({ sourceId: event.target.value })}
                  placeholder="例如：SYS-4 / DM-2"
                />
              </label>

              {addError && <Notice tone="red">{addError}</Notice>}

              <div className="modal-actions">
                <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>
                  取消
                </Button>
                <Button type="submit" variant="primary" disabled={adding}>
                  {adding ? "添加中…" : "添加设计单元"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function DesignDetail({
  unit,
  projectId,
  saving,
  deleting,
  canDelete,
  onConfirm,
  onDelete,
}: {
  unit: DesignUnit;
  projectId: string;
  saving: boolean;
  deleting: boolean;
  canDelete: boolean;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <div>
          <Tag tone={designTone(unit.type)}>{unit.type}</Tag>
          <h2 className="detail-code">{unit.code}</h2>
          <div className="muted small">{unit.name} · {unitLocator(unit)}</div>
        </div>
        <span className={`review-pill ${unit.reviewStatus === "confirmed" ? "ok" : ""}`}>
          {unit.reviewStatus === "confirmed" ? "已审核" : "待审核"}
        </span>
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
          {unit.obligations.length === 0 && <li className="muted">尚未生成设计义务。</li>}
        </ol>
      </div>

      <div className="meta-grid">
        <MetaItem label="子系统" value={unit.subsystem} />
        <MetaItem label="类型" value={unit.type} />
        <MetaItem label="原模块 ID" value={unit.parentSourceId || unit.sourceId || "—"} muted={!unit.parentSourceId && !unit.sourceId} />
        <MetaItem label="置信度" value={percent(unit.confidence * 100)} />
        <MetaItem label="来源章节（仅追溯）" value={unit.chapter} wide />
        <MetaItem
          label="定位"
          value={unit.location.page ? `${unitLocator(unit)}（按渲染分页估算）` : "手工添加"}
          wide
        />
        <MetaItem
          label="解析来源"
          value={
            unit.origin === "manual"
              ? "人工添加"
              : unit.origin === "llm"
                ? "LLM 判定设计点"
                : "设计表规则解析"
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
                  <th>长度</th>
                  <th>主键</th>
                </tr>
              </thead>
              <tbody>
                {unit.fields.map((field) => (
                  <tr key={field.name}>
                    <td className="mono">{field.name}</td>
                    <td>{field.meaning}</td>
                    <td>{field.type}</td>
                    <td>{field.length || "—"}</td>
                    <td>{field.primaryKey ? "√" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="detail-actions">
        <Button variant="primary" onClick={onConfirm} disabled={saving || unit.reviewStatus === "confirmed"}>
          {unit.reviewStatus === "confirmed" ? "已审核" : saving ? "保存中…" : "标记审核通过"}
        </Button>
        <Button
          variant="secondary"
          icon={<IconLink size={15} />}
          onClick={() => navigate(`/projects/${projectId}/evaluation?focus=${unit.code}`)}
        >
          在一致性评价中查看关系
        </Button>
        <Button
          variant="danger"
          icon={<IconTrash size={15} />}
          onClick={onDelete}
          disabled={deleting || !canDelete}
        >
          {deleting ? "删除中…" : canDelete ? "删除设计单元" : "LLM 整理中…"}
        </Button>
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
