import { Router } from "express";
import multer from "multer";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DocumentKind, RequirementType } from "../types.js";
import { REQUIREMENT_TYPES } from "../types.js";
import {
  decodeFilename,
  documentSummary,
  reparseDocument,
  recomputeRequirementStats,
  runEnrichment,
  saveParsedDocument,
} from "../services/documents.js";
import { getStore, mutateStore, projectDir, readSettings } from "../store.js";
import { nowIso } from "../util/id.js";

export const documentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
});

function requireDocStore(docId: string) {
  return getStore().then((data) => data.documents.find((d) => d.id === docId));
}

documentsRouter.post("/projects/:projectId/documents", upload.single("file"), async (req, res) => {
  const projectId = req.params.projectId;
  const data = await getStore();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "请选择要上传的 DOCX 文档" });
    return;
  }
  const kind = String(req.body?.kind ?? "") as DocumentKind;
  if (kind !== "srs" && kind !== "sdd") {
    res.status(400).json({ error: "kind 必须为 srs 或 sdd" });
    return;
  }
  const originalName = decodeFilename(file.originalname);
  if (!/\.docx$/i.test(originalName)) {
    res.status(400).json({ error: "当前版本支持 DOCX 文档，请先将 PDF/其他格式另存为 .docx 后上传。" });
    return;
  }
  const useLlm = String(req.body?.useLlm ?? "true") === "true";
  try {
    const doc = await saveParsedDocument({
      projectId,
      kind,
      originalName,
      buffer: file.buffer,
      useLlm,
    });
    res.status(201).json({ document: documentSummary(doc) });
  } catch (err) {
    res.status(400).json({ error: `文档解析失败：${(err as Error).message}` });
  }
});

documentsRouter.get("/projects/:projectId/documents", async (req, res) => {
  const data = await getStore();
  const project = data.projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  res.json({
    documents: data.documents
      .filter((d) => d.projectId === project.id)
      .map((d) => documentSummary(d)),
  });
});

documentsRouter.get("/projects/:projectId/documents/:kind", async (req, res) => {
  const kind = req.params.kind as DocumentKind;
  if (kind !== "srs" && kind !== "sdd") {
    res.status(400).json({ error: "kind 必须为 srs 或 sdd" });
    return;
  }
  const data = await getStore();
  const project = data.projects.find((p) => p.id === req.params.projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  const doc = data.documents
    .filter((d) => d.projectId === project.id && d.kind === kind)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
  if (!doc) {
    res.status(404).json({ error: kind === "srs" ? "尚未上传需求文档" : "尚未上传设计文档" });
    return;
  }
  res.json({ document: doc });
});

documentsRouter.delete("/projects/:projectId/documents/:docId", async (req, res) => {
  const projectId = req.params.projectId;
  const docId = req.params.docId;
  const removed = await mutateStore((data) => {
    const doc = data.documents.find((d) => d.id === docId && d.projectId === projectId);
    if (!doc) return undefined;
    data.documents = data.documents.filter((d) => d.id !== docId);
    return doc;
  });
  if (!removed) {
    res.status(404).json({ error: "文档不存在" });
    return;
  }
  try {
    const path = join(projectDir(projectId), removed.filename);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
});

documentsRouter.post("/projects/:projectId/documents/:docId/reparse", async (req, res) => {
  const doc = await requireDocStore(req.params.docId);
  if (!doc || doc.projectId !== req.params.projectId) {
    res.status(404).json({ error: "文档不存在" });
    return;
  }
  try {
    const updated = await reparseDocument(doc.id);
    if (!updated) {
      res.status(404).json({ error: "文档不存在" });
      return;
    }
    const settings = readSettings().llm;
    if (updated.useLlm && settings.apiKey && !settings.mock) {
      await mutateStore((data) => {
        const target = data.documents.find((d) => d.id === updated.id);
        if (target) target.status = "enriching";
      });
      void runEnrichment(updated.id);
    }
    res.json({ document: documentSummary(updated) });
  } catch (err) {
    res.status(400).json({ error: `重新拆分失败：${(err as Error).message}` });
  }
});

documentsRouter.post("/projects/:projectId/documents/:docId/enrich", async (req, res) => {
  const doc = await requireDocStore(req.params.docId);
  if (!doc || doc.projectId !== req.params.projectId) {
    res.status(404).json({ error: "文档不存在" });
    return;
  }
  const settings = readSettings().llm;
  if (!settings.apiKey || settings.mock) {
    res.status(400).json({ error: "未配置可用的 LLM，无法执行总结/分类" });
    return;
  }
  await mutateStore((data) => {
    const target = data.documents.find((d) => d.id === doc.id);
    if (target) {
      target.useLlm = true;
      target.status = "enriching";
    }
  });
  void runEnrichment(doc.id);
  res.json({ ok: true, status: "enriching" });
});

documentsRouter.patch("/projects/:projectId/requirements/:code", async (req, res) => {
  const projectId = req.params.projectId;
  const code = req.params.code;
  const typeRaw = req.body?.type !== undefined ? String(req.body.type) : undefined;
  if (typeRaw !== undefined && !REQUIREMENT_TYPES.includes(typeRaw as RequirementType)) {
    res.status(400).json({ error: "无效的需求类型" });
    return;
  }
  const note = req.body?.reviewNote !== undefined ? String(req.body.reviewNote).slice(0, 500) : undefined;
  const reviewStatus = req.body?.reviewStatus === "confirmed" ? "confirmed" : req.body?.reviewStatus === "pending" ? "pending" : undefined;

  const result = await mutateStore((data) => {
    const doc = data.documents
      .filter((d) => d.projectId === projectId && d.kind === "srs")
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    if (!doc) return undefined;
    const unit = doc.requirements.find((r) => r.code === code);
    if (!unit) return undefined;
    if (typeRaw !== undefined) unit.type = typeRaw as RequirementType;
    if (note !== undefined) unit.reviewNote = note;
    if (reviewStatus !== undefined) unit.reviewStatus = reviewStatus;
    recomputeRequirementStats(doc);
    doc.updatedAt = nowIso();
    const project = data.projects.find((p) => p.id === projectId);
    if (project) project.updatedAt = nowIso();
    return { unit, stats: doc.stats, type: unit.type };
  });
  if (!result) {
    res.status(404).json({ error: "需求单元不存在" });
    return;
  }
  res.json(result);
});

documentsRouter.patch("/projects/:projectId/design-units/:code", async (req, res) => {
  const projectId = req.params.projectId;
  const code = req.params.code;
  const note = req.body?.reviewNote !== undefined ? String(req.body.reviewNote).slice(0, 500) : undefined;
  const reviewStatus = req.body?.reviewStatus === "confirmed" ? "confirmed" : req.body?.reviewStatus === "pending" ? "pending" : undefined;
  const result = await mutateStore((data) => {
    const doc = data.documents
      .filter((d) => d.projectId === projectId && d.kind === "sdd")
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    if (!doc) return undefined;
    const unit = doc.designUnits.find((u) => u.code === code);
    if (!unit) return undefined;
    if (note !== undefined) unit.reviewNote = note;
    if (reviewStatus !== undefined) unit.reviewStatus = reviewStatus;
    doc.updatedAt = nowIso();
    return { unit };
  });
  if (!result) {
    res.status(404).json({ error: "设计单元不存在" });
    return;
  }
  res.json(result);
});
