import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, percent } from "../api";
import { useDebounced, useResource } from "../hooks";
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
import { IconLayers, IconLink, IconSearch } from "../components/Icons";
import { designTone, groupBySubsystem, unitLocator } from "../utils";
import type { DesignUnit } from "../types";

export function DesignPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const resource = useResource(() => api.getDocument(projectId, "sdd"), [projectId]);
  const doc = resource.data;

  const [subsystem, setSubsystem] = useState("全部");
  const [type, setType] = useState("全部");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 180);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "cards">("tree");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const units = doc?.designUnits ?? [];
  const selected = units.find((unit) => unit.code === selectedCode) ?? units[0];

  useEffect(() => {
    if (!selectedCode && units.length) setSelectedCode(units[0].code);
  }, [units, selectedCode]);

  const systems = useMemo(() => Object.keys(doc?.stats.bySubsystem ?? {}), [doc]);
  const types = useMemo(() => Object.keys(doc?.stats.byType ?? {}), [doc]);

  const filtered = useMemo(() => {
    const keyword = debouncedSearch.trim().toLowerCase();
    return units.filter((unit) => {
      if (subsystem !== "全部" && unit.subsystem !== subsystem) return false;
      if (type !== "全部" && unit.type !== type) return false;
      if (keyword) {
        const haystack = `${unit.code} ${unit.name} ${unit.description} ${unit.interfaceText} ${unit.chapter}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [units, subsystem, type, debouncedSearch]);

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

      {notice && <Notice tone={notice.includes("已标记") ? "green" : "red"}>{notice}</Notice>}

      <Card className="stats-card">
        <div className="stats-row">
          <div className="stat headline">
            <div className="stat-value">{units.length}</div>
            <div className="stat-label">设计单元</div>
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
            <Button variant="primary" icon={<IconLink size={15} />} onClick={() => navigate(`/projects/${projectId}/evaluation`)}>
              去一致性评价
            </Button>
          </div>
        </div>
        <div className="filter-row">
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
              onConfirm={confirmUnit}
            />
          ) : (
            <EmptyState compact title="选择一个设计单元" />
          )}
        </Card>
      </div>
    </>
  );
}

function DesignDetail({
  unit,
  projectId,
  saving,
  onConfirm,
}: {
  unit: DesignUnit;
  projectId: string;
  saving: boolean;
  onConfirm: () => void;
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
          <div className="section-label">LLM 设计摘要</div>
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
        <MetaItem label="章节" value={unit.chapter} wide />
        <MetaItem label="定位" value={`${unitLocator(unit)}（按渲染分页估算）`} wide />
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
