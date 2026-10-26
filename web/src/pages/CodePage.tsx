import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, formatBytes, formatDate } from "../api";
import { useResource } from "../hooks";
import {
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  Tag,
} from "../components/ui";
import { IconCode, IconFile, IconFolder, IconPlus, IconRefresh, IconTrash } from "../components/Icons";
import type { CodeFile, CodeSymbol, CodeTreeNode } from "../types";

const KIND_LABEL: Record<string, string> = {
  class: "类",
  interface: "接口",
  enum: "枚举",
  function: "函数",
  method: "方法",
  route: "路由",
  model: "模型",
  table: "数据表",
  component: "组件",
};

const KIND_TONE: Record<string, "blue" | "green" | "amber" | "red" | "purple" | "gray" | "cyan"> = {
  class: "blue",
  interface: "cyan",
  enum: "purple",
  function: "gray",
  method: "green",
  route: "amber",
  model: "purple",
  table: "purple",
  component: "cyan",
};

export function CodePage() {
  const { projectId = "" } = useParams();
  const snapshotResource = useResource(() => api.latestSnapshot(projectId), [projectId]);
  const snapshot = snapshotResource.data;
  const noSnapshot = !snapshot && Boolean(snapshotResource.error?.includes("尚未登记"));

  const [rootPath, setRootPath] = useState("");
  const [commit, setCommit] = useState("");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<CodeFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    setFormOpen(false);
    setRootPath(snapshot.rootPath);
    if (!selectedPath && snapshot.tree) {
      const first = findFirstFile(snapshot.tree);
      if (first) void openFile(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.id]);

  async function openFile(path: string) {
    if (!snapshot) return;
    setSelectedPath(path);
    setFileLoading(true);
    setError("");
    try {
      const result = await api.getSnapshotFile(projectId, snapshot.id, path);
      setFile(result);
    } catch (err) {
      setError((err as Error).message);
      setFile(null);
    } finally {
      setFileLoading(false);
    }
  }

  async function register() {
    if (!rootPath.trim()) {
      setError("请输入代码目录");
      return;
    }
    setRegistering(true);
    setError("");
    try {
      await api.registerSnapshot(projectId, rootPath.trim(), commit.trim());
      setSelectedPath(null);
      setFile(null);
      snapshotResource.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  }

  async function removeSnapshot() {
    if (!snapshot) return;
    if (!window.confirm("删除该代码快照？")) return;
    try {
      await api.deleteSnapshot(projectId, snapshot.id);
      setFile(null);
      setSelectedPath(null);
      snapshotResource.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="代码结构" subtitle="包、文件、类与方法；只评一致性，不评价代码质量" />

      {error && <Notice tone="red">{error}</Notice>}

      <Card
        label="CODE SNAPSHOT"
        title="代码快照"
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={() => snapshotResource.reload()}>
              刷新
            </Button>
            {snapshot && (
              <Button variant="ghost" size="sm" onClick={() => setFormOpen((open) => !open)}>
                {formOpen ? "收起" : "登记新快照"}
              </Button>
            )}
          </>
        }
      >
        <p className="card-desc">只做静态结构解析，不构建、不执行代码，不评价代码质量；扫描结果保存为代码快照，供设计→代码评价检索。</p>

        {snapshot && !formOpen && (
          <div className="snapshot-box">
            <div className="snapshot-main">
              <div className="snapshot-path">
                <IconCode size={16} />
                <span>{snapshot.rootPath}</span>
              </div>
              <div className="snapshot-meta">
                <span>提交 {snapshot.commit || "未记录"}</span>
                <span>{formatDate(snapshot.createdAt)}</span>
                <span>{snapshot.stats.files} 文件</span>
                <span>{snapshot.stats.lines.toLocaleString()} 行</span>
                <span>{snapshot.stats.symbols} 符号</span>
                <span>{snapshot.stats.routes} 路由</span>
              </div>
            </div>
            <div className="snapshot-actions">
              <Button variant="ghost" size="sm" icon={<IconTrash size={14} />} onClick={removeSnapshot}>
                删除
              </Button>
            </div>
          </div>
        )}

        {(formOpen || !snapshot) && (
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
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={register} disabled={registering}>
              {registering ? "扫描中…" : "登记代码快照"}
            </Button>
          </div>
        )}

        {snapshot?.warnings?.length ? <Notice tone="amber">{snapshot.warnings.join("；")}</Notice> : null}
        {noSnapshot && <div className="muted small">尚未登记代码快照。登记后即可在一致性评价中执行「设计 → 代码」检查。</div>}
      </Card>

      {!snapshot ? (
        <Card>
          <EmptyState
            icon={<IconCode size={30} />}
            title="还没有代码结构"
            description="登记代码目录后，会解析包、文件、类、方法、路由、数据表与配置。"
          />
        </Card>
      ) : (
        <>
          <div className="code-stats">
            <div className="stat">
              <div className="stat-value small-value">{snapshot.stats.files}</div>
              <div className="stat-label">文件</div>
            </div>
            <div className="stat">
              <div className="stat-value small-value">{snapshot.stats.lines.toLocaleString()}</div>
              <div className="stat-label">代码行</div>
            </div>
            <div className="stat">
              <div className="stat-value small-value">{snapshot.stats.symbols}</div>
              <div className="stat-label">符号</div>
            </div>
            <div className="stat">
              <div className="stat-value small-value">{snapshot.stats.routes}</div>
              <div className="stat-label">路由</div>
            </div>
            <div className="stat">
              <div className="stat-value small-value">{snapshot.stats.models}</div>
              <div className="stat-label">数据模型</div>
            </div>
            <div className="code-langs">
              {Object.entries(snapshot.stats.byLanguage)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([language, count]) => (
                  <Tag key={language} tone="gray">
                    {language} {count}
                  </Tag>
                ))}
            </div>
          </div>

          <div className="split-layout code-layout">
            <Card label="STRUCTURE" title="代码结构" className="list-card">
              <div className="code-tree">
                {snapshot.tree && <TreeNode node={snapshot.tree} selectedPath={selectedPath} onOpenFile={openFile} depth={0} />}
              </div>
            </Card>

            <Card className="detail-card">
              {fileLoading ? (
                <div className="loading-block">
                  <Spinner label="读取文件符号…" />
                </div>
              ) : file ? (
                <FileDetail file={file} />
              ) : (
                <EmptyState compact icon={<IconFile size={26} />} title="选择一个文件" description="查看文件中的类、方法、路由与模型。" />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function findFirstFile(node: CodeTreeNode): string | undefined {
  let best: { path: string; score: number } | undefined;
  let fallback: { path: string; score: number } | undefined;
  const visit = (current: CodeTreeNode): void => {
    if (current.type === "file") {
      const info = current.files?.[0];
      const score = (info?.symbolCount ?? 0) * 10000 + (info?.lines ?? 0);
      if (/\.(tsx?|jsx?|java|py|go|cs|vue)$/i.test(current.path)) {
        if (!best || score > best.score) best = { path: current.path, score };
      } else if (!fallback || score > fallback.score) {
        fallback = { path: current.path, score };
      }
      return;
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
  return best?.path ?? fallback?.path;
}

function TreeNode({
  node,
  selectedPath,
  onOpenFile,
  depth,
}: {
  node: CodeTreeNode;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 3);

  useEffect(() => {
    if (selectedPath && selectedPath.startsWith(`${node.path}/`)) setOpen(true);
  }, [selectedPath, node.path]);

  if (node.type === "file") {
    const info = node.files?.[0];
    return (
      <button
        className={`tree-file ${selectedPath === node.path ? "selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onOpenFile(node.path)}
      >
        <IconFile size={14} />
        <span className="tree-name">{node.name}</span>
        <span className="tree-meta">
          {info ? `${info.lines} 行${info.symbolCount ? ` · ${info.symbolCount} 符号` : ""}` : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="tree-dir">
      <button className="tree-dir-head" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen((value) => !value)}>
        <span className={`chevron ${open ? "open" : ""}`}>›</span>
        <IconFolder size={14} />
        <span className="tree-name">{node.name || "根目录"}</span>
        <span className="tree-meta">{node.fileCount}</span>
      </button>
      {open && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileDetail({ file }: { file: CodeFile }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = new Map<string, CodeSymbol[]>();
  for (const symbol of file.symbols) {
    const list = groups.get(symbol.kind) ?? [];
    list.push(symbol);
    groups.set(symbol.kind, list);
  }
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <div>
          <div className="muted small">{file.language}</div>
          <h2 className="detail-code file-path">{file.path}</h2>
          <div className="muted small">
            {file.lines} 行 · {formatBytes(file.bytes)} · {file.symbols.length} 个符号
          </div>
        </div>
      </div>

      {file.symbols.length === 0 ? (
        <EmptyState compact title="该文件未提取到符号" description="文件可能只包含配置、样式或简单导出。" />
      ) : (
        [...groups.entries()].map(([kind, symbols]) => (
          <div key={kind} className="detail-section">
            <div className="section-label">
              {KIND_LABEL[kind] ?? kind} ({symbols.length})
            </div>
            <div className="symbol-list">
              {symbols.map((symbol) => (
                <div key={symbol.id} className="symbol-item">
                  <button
                    className="symbol-row"
                    onClick={() => setExpanded((current) => (current === symbol.id ? null : symbol.id))}
                  >
                    <Tag tone={KIND_TONE[kind] ?? "gray"}>{KIND_LABEL[kind] ?? kind}</Tag>
                    <span className="symbol-name mono">{symbol.name}</span>
                    <span className="muted small">L{symbol.line}</span>
                  </button>
                  {expanded === symbol.id && <pre className="code-block snippet">{symbol.snippet}</pre>}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
