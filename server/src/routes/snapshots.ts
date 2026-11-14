/**
 * 代码快照 API。
 *
 * 登记代码目录快照、读取文件符号和删除快照。
 */

import { Router } from "express";
import { buildCodeTree, scanCodeSnapshot } from "../parsers/code.js";
import { getStore, mutateStore } from "../store.js";
import type { CodeSnapshot } from "../types.js";

export const snapshotsRouter = Router();

function snapshotMeta(snapshot: CodeSnapshot) {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    rootPath: snapshot.rootPath,
    commit: snapshot.commit,
    createdAt: snapshot.createdAt,
    status: snapshot.status,
    error: snapshot.error,
    stats: snapshot.stats,
    warnings: snapshot.warnings,
  };
}

function snapshotTree(snapshot: CodeSnapshot) {
  const lightweight = snapshot.files.map((file) => ({
    ...file,
    symbols: [] as CodeSnapshot["files"][number]["symbols"],
    symbolCount: file.symbols.length,
  }));
  return buildCodeTree(lightweight);
}

/**
 * 登记代码快照。
 *
 * 扫描代码目录，保存符号、路由、模型和 Git commit。
 *
 * 前端入口：项目详情页/代码页「登记代码快照」（ProjectDetailPage.tsx:140、CodePage.tsx:104）
 */
snapshotsRouter.post("/projects/:projectId/snapshots", async (req, res) => {
  const projectId = req.params.projectId;
  const store = await getStore();
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  const rootPath = String(req.body?.rootPath ?? "").trim();
  const commit = String(req.body?.commit ?? "").trim();
  if (!rootPath) {
    res.status(400).json({ error: "请输入代码目录" });
    return;
  }
  try {
    const snapshot = scanCodeSnapshot(projectId, rootPath, commit);
    await mutateStore((data) => {
      data.snapshots.push(snapshot);
      const mine = data.snapshots
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (mine.length > 3) {
        const keep = new Set(mine.slice(0, 3).map((s) => s.id));
        data.snapshots = data.snapshots.filter((s) => s.projectId !== projectId || keep.has(s.id));
      }
      const target = data.projects.find((p) => p.id === projectId);
      if (target) target.updatedAt = new Date().toISOString();
    });
    res.status(201).json({ snapshot: { ...snapshotMeta(snapshot), tree: snapshotTree(snapshot) } });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 前端入口：项目详情页/评价页加载快照列表（ProjectDetailPage.tsx:43、EvaluationPage.tsx:41）
snapshotsRouter.get("/projects/:projectId/snapshots", async (req, res) => {
  const data = await getStore();
  res.json({
    snapshots: data.snapshots
      .filter((s) => s.projectId === req.params.projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(snapshotMeta),
  });
});

// 前端入口：代码页默认加载最新快照（CodePage.tsx:54）
snapshotsRouter.get("/projects/:projectId/snapshots/latest", async (req, res) => {
  const data = await getStore();
  const snapshot = data.snapshots
    .filter((s) => s.projectId === req.params.projectId && s.status === "ready")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!snapshot) {
    res.status(404).json({ error: "尚未登记代码快照" });
    return;
  }
  res.json({ snapshot: { ...snapshotMeta(snapshot), tree: snapshotTree(snapshot) } });
});

// 前端入口：代码页点击文件树中的文件（CodePage.tsx:86）
snapshotsRouter.get("/projects/:projectId/snapshots/:snapshotId/file", async (req, res) => {
  const data = await getStore();
  const snapshot = data.snapshots.find((s) => s.id === req.params.snapshotId && s.projectId === req.params.projectId);
  if (!snapshot) {
    res.status(404).json({ error: "快照不存在" });
    return;
  }
  const filePath = String(req.query.path ?? "");
  const file = snapshot.files.find((f) => f.path === filePath);
  if (!file) {
    res.status(404).json({ error: "文件不存在于该快照" });
    return;
  }
  res.json({ file });
});

// 前端入口：项目详情页快照「删除」、代码页删除快照（ProjectDetailPage.tsx:156、CodePage.tsx:119）
snapshotsRouter.delete("/projects/:projectId/snapshots/:snapshotId", async (req, res) => {
  const removed = await mutateStore((data) => {
    const snapshot = data.snapshots.find((s) => s.id === req.params.snapshotId && s.projectId === req.params.projectId);
    if (!snapshot) return false;
    data.snapshots = data.snapshots.filter((s) => s.id !== snapshot.id);
    return true;
  });
  if (!removed) {
    res.status(404).json({ error: "快照不存在" });
    return;
  }
  res.json({ ok: true });
});
