import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatDate, formatShortDate, formatBytes } from "../api";
import { useInterval, useResource } from "../hooks";
import {
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  StatusPill,
  Tag,
} from "../components/ui";
import {
  IconArrowLeft,
  IconCode,
  IconFile,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "../components/Icons";
import type { Campaign, DocumentKind, DocumentSummary, SnapshotMeta } from "../types";

export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const project = useResource(() => api.getProject(projectId), [projectId]);
  const documents = useResource(() => api.listDocuments(projectId), [projectId]);
  const snapshots = useResource(() => api.listSnapshots(projectId), [projectId]);
  const campaigns = useResource(() => api.listCampaigns(projectId), [projectId]);

  const [useLlm, setUseLlm] = useState(true);
  const [uploading, setUploading] = useState<DocumentKind | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [codeFormOpen, setCodeFormOpen] = useState(false);
  const [rootPath, setRootPath] = useState("");
  const [commit, setCommit] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const srsInput = useRef<HTMLInputElement>(null);
  const sddInput = useRef<HTMLInputElement>(null);

  const srs = documents.data?.find((d) => d.kind === "srs");
  const sdd = documents.data?.find((d) => d.kind === "sdd");
  const snapshot = useMemo<SnapshotMeta | undefined>(
    () => snapshots.data?.find((s) => s.status === "ready"),
    [snapshots.data],
  );

  const enriching = documents.data?.some((d) => d.status === "enriching" || d.status === "parsing");
  useInterval(
    () => {
      documents.reload();
      project.reload();
    },
    enriching ? 2500 : null,
  );

  function refreshAll() {
    project.reload();
    documents.reload();
    snapshots.reload();
    campaigns.reload();
  }

  async function handleUpload(kind: DocumentKind, file: File) {
    setUploading(kind);
    setError("");
    try {
      await api.uploadDocument(projectId, kind, file, useLlm);
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function removeDocument(doc: DocumentSummary) {
    if (!window.confirm(`确认撤销导入「${doc.originalName}」？相关评价记录会保留，但需要重新上传后才能再次评价。`)) return;
    setBusy(doc.id);
    try {
      await api.deleteDocument(projectId, doc.id);
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function reparse(doc: DocumentSummary) {
    setBusy(doc.id);
    setError("");
    try {
      await api.reparseDocument(projectId, doc.id);
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function enrich(doc: DocumentSummary) {
    setBusy(doc.id);
    setError("");
    try {
      await api.enrichDocument(projectId, doc.id);
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function registerSnapshot() {
    if (!rootPath.trim()) {
      setError("请输入代码目录");
      return;
    }
    setBusy("snapshot");
    setError("");
    try {
      await api.registerSnapshot(projectId, rootPath.trim(), commit.trim());
      setCodeFormOpen(false);
      setRootPath("");
      setCommit("");
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function removeSnapshot(snapshotId: string) {
    if (!window.confirm("删除该代码快照？")) return;
    setBusy("snapshot");
    try {
      await api.deleteSnapshot(projectId, snapshotId);
      refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function deleteProject() {
    if (!window.confirm(`删除项目「${project.data?.name ?? ""}」及其文档、快照和评价记录？此操作不可恢复。`)) return;
    try {
      await api.deleteProject(projectId);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createCampaign() {
    setCreatingCampaign(true);
    setError("");
    try {
      const levels: Array<"requirement_design" | "design_code"> = [];
      if (srs && sdd) levels.push("requirement_design");
      if (sdd && snapshot) levels.push("design_code");
      if (!levels.length) {
        setError("请先上传需求文档、设计文档，并登记代码快照。");
        return;
      }
      const campaign = await api.createCampaign(projectId, { levels, subsystems: [] });
      navigate(`/projects/${projectId}/evaluation?campaign=${campaign.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingCampaign(false);
    }
  }

  const tabs = [
    { key: "overview", label: "需求结构", to: `/projects/${projectId}/requirements` },
    { key: "design", label: "设计结构", to: `/projects/${projectId}/design` },
    { key: "code", label: "代码结构", to: `/projects/${projectId}/code` },
    { key: "evaluation", label: "一致性评价", to: `/projects/${projectId}/evaluation` },
    { key: "reports", label: "评价报告", to: `/projects/${projectId}/reports` },
  ];

  return (
    <>
      <PageHeader
        title="项目与资料"
        subtitle="管理需求文档、设计文档和代码快照"
        actions={
          <>
            <Button variant="ghost" icon={<IconArrowLeft size={16} />} onClick={() => navigate("/")}>
              返回
            </Button>
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={createCampaign} disabled={creatingCampaign}>
              {creatingCampaign ? "创建中…" : "开始一致性评价"}
            </Button>
          </>
        }
      />

      {error && <Notice tone="red">{error}</Notice>}
      {project.error && <Notice tone="red">{project.error}</Notice>}

      <Card
        label="PROJECT"
        title={project.data?.name ?? "—"}
        actions={
          <Button variant="ghost" size="sm" icon={<IconTrash size={14} />} onClick={deleteProject}>
            删除项目
          </Button>
        }
      >
        <div className="project-overview">
          <p className="muted">{project.data?.description || "暂无说明"}</p>
          <div className="project-overview-meta">
            <span>{(srs ? 1 : 0) + (sdd ? 1 : 0)} 文档</span>
            <span>{snapshot ? 1 : 0} 代码快照</span>
            <span>{campaigns.data?.length ?? 0} 次评价</span>
            <span>创建于 {formatShortDate(project.data?.createdAt)}</span>
          </div>
        </div>
        <div className="project-tabs">
          {tabs.map((tab) => (
            <button key={tab.key} className="project-tab" onClick={() => navigate(tab.to)}>
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="two-col">
        <DocumentCard
          kind="srs"
          label="SRS"
          title="需求文档"
          doc={srs}
          useLlm={useLlm}
          onUseLlm={setUseLlm}
          uploading={uploading === "srs"}
          busy={busy === srs?.id}
          inputRef={srsInput}
          onPick={() => srsInput.current?.click()}
          onUpload={(file) => handleUpload("srs", file)}
          onReparse={() => srs && reparse(srs)}
          onEnrich={() => srs && enrich(srs)}
          onRemove={() => srs && removeDocument(srs)}
          emptyHint="支持 DOCX；需求表会解析为需求单元与原子义务。"
        />

        <DocumentCard
          kind="sdd"
          label="SDD"
          title="设计文档"
          doc={sdd}
          useLlm={useLlm}
          onUseLlm={setUseLlm}
          uploading={uploading === "sdd"}
          busy={busy === sdd?.id}
          inputRef={sddInput}
          onPick={() => sddInput.current?.click()}
          onUpload={(file) => handleUpload("sdd", file)}
          onReparse={() => sdd && reparse(sdd)}
          onEnrich={() => sdd && enrich(sdd)}
          onRemove={() => sdd && removeDocument(sdd)}
          emptyHint="支持 DOCX；设计表会解析为模块、子功能、数据表与页面单元。"
        />
      </div>

      <Card
        label="IMPLEMENTATION"
        title="代码快照"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = !codeFormOpen;
              setCodeFormOpen(next);
              if (next && snapshot) {
                setRootPath(snapshot.rootPath);
                setCommit(snapshot.commit);
              }
            }}
            icon={<IconCode size={15} />}
          >
            {codeFormOpen ? "收起" : snapshot ? "登记新快照" : "登记代码快照"}
          </Button>
        }
      >
        <p className="card-desc">只做静态结构解析，不构建、不执行代码，不评价代码质量。</p>
        {snapshot && (
          <div className="snapshot-box">
            <div className="snapshot-main">
              <div className="snapshot-path">
                <IconCode size={16} />
                <span>{snapshot.rootPath}</span>
              </div>
              <div className="snapshot-meta">
                <span>提交 {snapshot.commit || "未记录"}</span>
                <span>{formatShortDate(snapshot.createdAt)}</span>
                <span>{snapshot.stats.files} 文件</span>
                <span>{snapshot.stats.lines.toLocaleString()} 行</span>
                <span>{snapshot.stats.symbols} 符号</span>
                <span>{snapshot.stats.routes} 路由</span>
              </div>
            </div>
            <div className="snapshot-actions">
              <Button variant="ghost" size="sm" icon={<IconTrash size={14} />} onClick={() => removeSnapshot(snapshot.id)}>
                删除
              </Button>
            </div>
          </div>
        )}
        {(codeFormOpen || !snapshot) && (
          <div className="snapshot-form">
            <label className="field">
              <span>代码目录</span>
              <input
                value={rootPath}
                placeholder="例如：D:\projects\dt-backend"
                onChange={(event) => setRootPath(event.target.value)}
              />
            </label>
            <label className="field field-commit">
              <span>提交（可选）</span>
              <input value={commit} placeholder="Git commit SHA" onChange={(event) => setCommit(event.target.value)} />
            </label>
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={registerSnapshot} disabled={busy === "snapshot"}>
              {busy === "snapshot" ? "扫描中…" : "登记代码快照"}
            </Button>
          </div>
        )}
        {snapshot?.warnings?.length ? <Notice tone="amber">{snapshot.warnings.join("；")}</Notice> : null}
        <div className="inline-actions">
          <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={() => navigate(`/projects/${projectId}/code`)}>
            查看代码结构
          </Button>
        </div>
      </Card>

      <Card
        label="CAMPAIGNS"
        title="评价历史"
        actions={
          <Button variant="primary" size="sm" icon={<IconPlus size={15} />} onClick={createCampaign} disabled={creatingCampaign}>
            创建评价
          </Button>
        }
      >
        {campaigns.data?.length ? (
          <div className="campaign-list">
            {campaigns.data.map((campaign) => (
              <CampaignRow
                key={campaign.id}
                campaign={campaign}
                onOpen={() => navigate(`/projects/${projectId}/evaluation?campaign=${campaign.id}`)}
                onReport={() => navigate(`/projects/${projectId}/reports/${campaign.id}`)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconFolder size={30} />}
            title="还没有评价活动"
            description="完成文档上传后，进入一致性评价创建活动。"
            actions={
              <Button variant="primary" size="sm" icon={<IconPlus size={15} />} onClick={createCampaign}>
                创建评价
              </Button>
            }
          />
        )}
      </Card>

      <input
        ref={srsInput}
        type="file"
        accept=".docx"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUpload("srs", file);
          event.target.value = "";
        }}
      />
      <input
        ref={sddInput}
        type="file"
        accept=".docx"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUpload("sdd", file);
          event.target.value = "";
        }}
      />
    </>
  );
}

function DocumentCard({
  kind,
  label,
  title,
  doc,
  useLlm,
  onUseLlm,
  uploading,
  busy,
  onPick,
  onUpload,
  onReparse,
  onEnrich,
  onRemove,
  emptyHint,
}: {
  kind: DocumentKind;
  label: string;
  title: string;
  doc?: DocumentSummary;
  useLlm: boolean;
  onUseLlm: (value: boolean) => void;
  uploading: boolean;
  busy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onUpload: (file: File) => void;
  onReparse: () => void;
  onEnrich: () => void;
  onRemove: () => void;
  emptyHint: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <Card
      label={label}
      title={title}
      actions={
        <>
          <label className="checkbox">
            <input type="checkbox" checked={useLlm} onChange={(event) => onUseLlm(event.target.checked)} />
            使用 LLM 总结/分类
          </label>
          <Button variant="soft" size="sm" icon={<IconUpload size={14} />} onClick={onPick} disabled={uploading}>
            {uploading ? "上传中…" : "上传 DOCX"}
          </Button>
        </>
      }
    >
      {doc ? (
        <div className="doc-info">
          <div className="doc-title-row">
            <span className="doc-icon">
              <IconFile size={18} />
            </span>
            <div className="doc-title-main">
              <strong>{doc.originalName}</strong>
              <div className="muted small">
                版本 {doc.version} · {formatDate(doc.uploadedAt)} · {formatBytes(doc.size)} ·{" "}
                {kind === "srs"
                  ? `已生成 ${doc.requirementCount} 个单元 · ${doc.requirementPointCount ?? 0} 个需求点`
                  : `已拆分 ${doc.designCount} 个单元`}
              </div>
            </div>
            <StatusPill status={doc.status} />
          </div>
          {doc.status === "enriching" && (
            <div className="inline-loading">
              <Spinner size={14} label="LLM 正在整理摘要、义务与分类…" />
            </div>
          )}
          {doc.warnings?.length ? (
            <div className="doc-warnings">
              {doc.warnings.slice(0, 4).map((warning, index) => (
                <div key={index} className="warning-line">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
          <div className="doc-stats">
            <span>{doc.stats.pages} 页</span>
            <span>{doc.stats.tables} 表</span>
            <span>{doc.stats.paragraphs} 段</span>
            <span>解析方式 {doc.useLlm ? "LLM 辅助" : "规则解析"}</span>
          </div>
          <div className="doc-actions">
            <Button variant="secondary" size="sm" onClick={onReparse} disabled={busy || uploading}>
              {busy ? "处理中…" : "重新拆分"}
            </Button>
            <Button variant="soft" size="sm" onClick={onEnrich} disabled={busy || uploading || doc.status === "enriching"}>
              LLM 整理
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy || uploading}>
              撤销导入
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone ${dragOver ? "drag-over" : ""}`}
          onClick={onPick}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) onUpload(file);
          }}
        >
          {uploading ? (
            <Spinner label="正在解析文档…" />
          ) : (
            <>
              <div className="dropzone-icon">
                <IconUpload size={22} />
              </div>
              <div className="dropzone-title">尚未上传{kind === "srs" ? "需求" : "设计"}文档</div>
              <div className="dropzone-desc">{emptyHint}</div>
              <div className="dropzone-hint">点击选择或拖拽 .docx 文件到此处</div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function CampaignRow({
  campaign,
  onOpen,
  onReport,
}: {
  campaign: Campaign;
  onOpen: () => void;
  onReport: () => void;
}) {
  const score = campaign.summary?.score;
  return (
    <div className="campaign-row">
      <div className="campaign-main" onClick={onOpen}>
        <div className="campaign-name">
          {campaign.name} <StatusPill status={campaign.status} />
        </div>
        <div className="campaign-meta">
          {campaign.levels.map((level) => (
            <Tag key={level} tone="blue">
              {level === "requirement_design" ? "需求→设计" : "设计→代码"}
            </Tag>
          ))}
          <span>{formatShortDate(campaign.createdAt)}</span>
          <span>{campaign.method === "llm" ? campaign.model : "规则匹配"}</span>
        </div>
      </div>
      <div className="campaign-score">
        {typeof score === "number" ? (
          <>
            <strong>{score.toFixed(1)}</strong>
            <span>分</span>
          </>
        ) : (
          <span className="muted">{campaign.status === "running" ? `${campaign.progress.done}/${campaign.progress.total}` : "—"}</span>
        )}
      </div>
      <div className="campaign-actions">
        {campaign.status === "completed" && (
          <Button variant="ghost" size="sm" onClick={onReport}>
            查看报告
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onOpen}>
          详情
        </Button>
      </div>
    </div>
  );
}
