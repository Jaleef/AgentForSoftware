/**
 * 项目列表页面。
 *
 * 展示项目、统计摘要并支持新建项目。
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatShortDate } from "../api";
import { useResource } from "../hooks";
import { Button, Card, EmptyState, Notice, PageHeader, Spinner } from "../components/ui";
import { IconArrowLeft, IconFolder, IconPlus } from "../components/Icons";
import type { ProjectSummary } from "../types";

/**
 * 项目列表页面入口。
 *
 * 展示项目卡片、统计摘要并支持创建项目。
 */
export function ProjectsPage() {
  const navigate = useNavigate();
  const projects = useResource(() => api.listProjects(), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const project = await api.createProject(name.trim(), description.trim());
      setName("");
      setDescription("");
      projects.reload();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader title="项目与资料" subtitle="管理需求文档、设计文档和代码快照" />

      {error && <Notice tone="red">{error}</Notice>}
      {projects.error && <Notice tone="red">{projects.error}</Notice>}

      <Card
        label="PROJECTS"
        title="项目列表"
        actions={
          <Button variant="primary" size="sm" icon={<IconPlus size={15} />} onClick={() => projects.reload()}>
            刷新
          </Button>
        }
      >
        {projects.loading && !projects.data ? (
          <div className="loading-block">
            <Spinner label="加载项目…" />
          </div>
        ) : projects.data?.length ? (
          <div className="project-grid">
            {projects.data.map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={() => navigate(`/projects/${project.id}`)} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconFolder size={30} />}
            title="还没有项目"
            description="创建项目后，上传需求文档、设计文档并登记代码快照，即可开始一致性评价。"
          />
        )}
      </Card>

      <Card label="NEW PROJECT" title="新建项目">
        <div className="form-row">
          <label className="field">
            <span>项目名称</span>
            <input
              value={name}
              placeholder="例如：DT 数字孪生系统"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && create()}
            />
          </label>
          <label className="field field-grow">
            <span>说明</span>
            <input
              value={description}
              placeholder="项目范围或备注"
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && create()}
            />
          </label>
        </div>
        <div className="form-actions">
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={create} disabled={creating}>
            {creating ? "创建中…" : "创建项目"}
          </Button>
          <span className="hint">项目数据保存在本机 data 目录，不会上传到第三方。</span>
        </div>
      </Card>
    </>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  const docCount = (project.requirementDoc ? 1 : 0) + (project.designDoc ? 1 : 0);
  const snapshotCount = project.snapshot ? 1 : 0;
  return (
    <button className="project-card" onClick={onOpen}>
      <div className="project-card-top">
        <span className="project-icon">
          <IconFolder size={18} />
        </span>
        <span className="project-meta">
          {docCount} 文档 · {snapshotCount} 代码快照
        </span>
      </div>
      <div className="project-name">{project.name}</div>
      <div className="project-desc">{project.description || "暂无项目说明"}</div>
      <div className="project-card-footer">
        <span>{project.campaignCount} 次评价</span>
        <span>{formatShortDate(project.updatedAt)}</span>
      </div>
    </button>
  );
}
