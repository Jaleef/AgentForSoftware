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

projectsRouter.get("/projects/:projectId", async (req, res) => {
  const data = await getStore();
  const project = data.projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  res.json({ project: projectOverview(data, project) });
});

projectsRouter.patch("/projects/:projectId", async (req, res) => {
  const projectId = req.params.projectId;
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : undefined;
  if (name !== undefined && (!name || name.length > 80)) {
    res.status(400).json({ error: "项目名称不能为空且不能超过 80 个字符" });
    return;
  }
  const project = await mutateStore((data) => {
    const target = data.projects.find((p) => p.id === projectId);
    if (!target) return undefined;
    if (name !== undefined) target.name = name;
    if (description !== undefined) target.description = description.slice(0, 500);
    target.updatedAt = nowIso();
    return target;
  });
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  res.json({ project });
});

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

projectsRouter.get("/projects/:projectId/overview", async (req, res) => {
  const data = await getStore();
  const project = data.projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  res.json({ overview: projectOverview(data, project) });
});
