/**
 * 项目 API。
 *
 * 项目列表、创建、详情和级联删除。
 */

import { Router } from "express";
import { rmSync } from "node:fs";
import { getStore, mutateStore, projectDir } from "../store.js";
import { newId, nowIso } from "../util/id.js";
import { projectOverview, summarizeProject } from "../services/projects.js";
import type { Project } from "../types.js";

export const projectsRouter = Router();

// 前端入口：项目列表页与顶部项目切换下拉（web/src/pages/ProjectsPage.tsx:22、web/src/components/Layout.tsx:44）
projectsRouter.get("/projects", async (_req, res) => {
  const data = await getStore();
  const projects = [...data.projects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((project) => summarizeProject(data, project));
  res.json({ projects });
});

/**
 * 创建项目。
 *
 * 写入项目基本信息并返回项目详情。
 *
 * 前端入口：项目列表页「创建项目」按钮（ProjectsPage.tsx:36）
 */
projectsRouter.post("/projects", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const description = String(req.body?.description ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "项目名称不能为空" });
    return;
  }
  if (name.length > 80) {
    res.status(400).json({ error: "项目名称不能超过 80 个字符" });
    return;
  }
  const now = nowIso();
  const project: Project = {
    id: newId("prj"),
    name,
    description: description.slice(0, 500),
    createdAt: now,
    updatedAt: now,
  };
  await mutateStore((data) => {
    data.projects.push(project);
  });
  res.status(201).json({ project });
});

// 前端入口：进入项目详情/评价/报告页时加载项目基本信息（ProjectDetailPage.tsx:41、EvaluationPage.tsx:36、ReportsPage.tsx:23、ReportDetailPage.tsx:37）
projectsRouter.get("/projects/:projectId", async (req, res) => {
  const data = await getStore();
  const project = data.projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  res.json({ project: projectOverview(data, project) });
});

// 前端入口：项目详情页「删除项目」按钮（ProjectDetailPage.tsx:168）
projectsRouter.delete("/projects/:projectId", async (req, res) => {
  const projectId = req.params.projectId;
  const removed = await mutateStore((data) => {
    const project = data.projects.find((p) => p.id === projectId);
    if (!project) return false;
    data.projects = data.projects.filter((p) => p.id !== projectId);
    data.documents = data.documents.filter((d) => d.projectId !== projectId);
    data.snapshots = data.snapshots.filter((s) => s.projectId !== projectId);
    data.campaigns = data.campaigns.filter((c) => c.projectId !== projectId);
    return true;
  });
  if (!removed) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  try {
    rmSync(projectDir(projectId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
});
