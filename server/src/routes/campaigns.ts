/**
 * 评价任务与报告 API。
 *
 * 创建/查询/取消评价任务，人工确认或驳回关系，导出报告。
 */

import { Router } from "express";
import type { Campaign, RelationLevel } from "../types.js";
import { getStore, mutateStore } from "../store.js";
import { newId, nowIso } from "../util/id.js";
import { startCampaignRun, cancelCampaignRun } from "../evaluation/runner.js";
import { computeSummary } from "../evaluation/summary.js";
import { campaignCsv, campaignMarkdown, reportFileName } from "../services/report.js";
import { latestDoc, latestSnapshot, projectCampaigns } from "../services/projects.js";

export const campaignsRouter = Router();

const LEVELS: RelationLevel[] = ["requirement_design", "design_code"];

/**
 * 创建评价任务。
 *
 * 校验文档/层级/子系统，写入 queued 任务并异步启动 runner。
 */
campaignsRouter.post("/projects/:projectId/campaigns", async (req, res) => {
  const projectId = req.params.projectId;
  const data = await getStore();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: "项目不存在" });
    return;
  }
  if (data.campaigns.some((c) => c.projectId === projectId && (c.status === "queued" || c.status === "running"))) {
    res.status(409).json({ error: "已有评价任务正在运行，请等待完成或先取消。" });
    return;
  }
  const srs = latestDoc(data, projectId, "srs");
  const sdd = latestDoc(data, projectId, "sdd");
  const snapshot = latestSnapshot(data, projectId);

  const requested = Array.isArray(req.body?.levels)
    ? (req.body.levels as string[]).filter((l): l is RelationLevel => LEVELS.includes(l as RelationLevel))
    : [];
  let levels: RelationLevel[] = [...new Set(requested)];
  if (!levels.length) {
    levels = [];
    if (srs && sdd && srs.requirements.length && sdd.designUnits.length) levels.push("requirement_design");
    if (sdd && snapshot && sdd.designUnits.length) levels.push("design_code");
  }
  if (!levels.length) {
    res.status(400).json({ error: "缺少可评价的文档：请先上传需求文档、设计文档，并登记代码快照。" });
    return;
  }
  if (levels.includes("requirement_design")) {
    if (!srs || !srs.requirements.length) {
      res.status(400).json({ error: "需求→设计评价需要已解析的需求文档。" });
      return;
    }
    if (!sdd || !sdd.designUnits.length) {
      res.status(400).json({ error: "需求→设计评价需要已解析的设计文档。" });
      return;
    }
  }
  if (levels.includes("design_code")) {
    if (!sdd || !sdd.designUnits.length) {
      res.status(400).json({ error: "设计→代码评价需要已解析的设计文档。" });
      return;
    }
    if (!snapshot) {
      res.status(400).json({ error: "设计→代码评价需要先登记代码快照。" });
      return;
    }
  }

  const knownSubsystems = new Set<string>([
    ...(srs?.requirements.map((r) => r.subsystem) ?? []),
    ...(sdd?.designUnits.map((d) => d.subsystem) ?? []),
  ]);
  const subsystems = Array.isArray(req.body?.subsystems)
    ? (req.body.subsystems as unknown[]).filter((s): s is string => typeof s === "string" && knownSubsystems.has(s))
    : [];

  const stamp = new Date();
  const defaultName = `${levels.includes("requirement_design") ? "需求→设计" : ""}${levels.length === 2 ? " + " : ""
    }${levels.includes("design_code") ? "设计→代码" : ""} · ${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(
      stamp.getDate(),
    ).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;

  const campaign: Campaign = {
    id: newId("cmp"),
    projectId,
    name: String(req.body?.name ?? "").trim().slice(0, 120) || defaultName,
    levels,
    subsystems,
    status: "queued",
    phase: "queued",
    progress: { done: 0, total: 1, message: "任务已排队" },
    provider: "pending",
    model: "",
    method: "heuristic",
    relations: [],
    createdAt: nowIso(),
  };

  await mutateStore((store) => {
    store.campaigns.push(campaign);
    const target = store.projects.find((p) => p.id === projectId);
    if (target) target.updatedAt = nowIso();
  });

  void startCampaignRun(campaign.id, projectId);
  res.status(201).json({ campaign });
});

campaignsRouter.get("/projects/:projectId/campaigns", async (req, res) => {
  const data = await getStore();
  const campaigns = projectCampaigns(data, req.params.projectId).map((campaign) => ({
    ...campaign,
    relations: [],
  }));
  res.json({ campaigns });
});

/**
 * 查询评价任务详情。
 *
 * 支持 statusOnly=1 的轻量轮询，避免重复传输完整关系列表。
 */
campaignsRouter.get("/projects/:projectId/campaigns/:campaignId", async (req, res) => {
  const data = await getStore();
  const campaign = data.campaigns.find((c) => c.id === req.params.campaignId && c.projectId === req.params.projectId);
  if (!campaign) {
    res.status(404).json({ error: "评价任务不存在" });
    return;
  }
  if (req.query.statusOnly === "1") {
    const { relations, ...rest } = campaign;
    res.json({
      campaign: {
        ...rest,
        relations: [],
        agentRuns: (rest.agentRuns ?? []).slice(-5),
      },
    });
    return;
  }
  res.json({ campaign });
});

campaignsRouter.post("/projects/:projectId/campaigns/:campaignId/cancel", async (req, res) => {
  const data = await getStore();
  const campaign = data.campaigns.find((c) => c.id === req.params.campaignId && c.projectId === req.params.projectId);
  if (!campaign) {
    res.status(404).json({ error: "评价任务不存在" });
    return;
  }
  const cancelled = cancelCampaignRun(campaign.id);
  if (!cancelled) {
    res.status(400).json({ error: "任务不在运行中" });
    return;
  }
  res.json({ ok: true });
});

campaignsRouter.delete("/projects/:projectId/campaigns/:campaignId", async (req, res) => {
  const removed = await mutateStore((data) => {
    const before = data.campaigns.length;
    data.campaigns = data.campaigns.filter(
      (c) => !(c.id === req.params.campaignId && c.projectId === req.params.projectId),
    );
    return data.campaigns.length < before;
  });
  if (!removed) {
    res.status(404).json({ error: "评价任务不存在" });
    return;
  }
  res.json({ ok: true });
});

campaignsRouter.patch("/projects/:projectId/campaigns/:campaignId/relations/:relationId", async (req, res) => {
  const reviewStatus = req.body?.reviewStatus;
  if (!["pending", "accepted", "rejected"].includes(reviewStatus)) {
    res.status(400).json({ error: "reviewStatus 必须为 pending / accepted / rejected" });
    return;
  }
  const note = req.body?.reviewNote !== undefined ? String(req.body.reviewNote).slice(0, 500) : undefined;
  const data = await getStore();
  const srs = latestDoc(data, req.params.projectId, "srs");
  const sdd = latestDoc(data, req.params.projectId, "sdd");
  const result = await mutateStore((store) => {
    const campaign = store.campaigns.find(
      (c) => c.id === req.params.campaignId && c.projectId === req.params.projectId,
    );
    if (!campaign) return undefined;
    const relation = campaign.relations.find((r) => r.id === req.params.relationId);
    if (!relation) return undefined;
    relation.reviewStatus = reviewStatus;
    if (note !== undefined) relation.reviewNote = note;
    const valid = campaign.relations.filter((r) => r.reviewStatus !== "rejected");
    const subsystemSet = new Set(campaign.subsystems ?? []);
    const requirements = (srs?.requirements ?? []).filter(
      (r) => !subsystemSet.size || subsystemSet.has(r.subsystem),
    );
    const designs = (sdd?.designUnits ?? []).filter((d) => !subsystemSet.size || subsystemSet.has(d.subsystem));
    campaign.summary = computeSummary(valid, designs, requirements.length);
    return { relation, summary: campaign.summary };
  });
  if (!result) {
    res.status(404).json({ error: "关系条目不存在" });
    return;
  }
  res.json(result);
});

campaignsRouter.get("/projects/:projectId/campaigns/:campaignId/export", async (req, res) => {
  const data = await getStore();
  const campaign = data.campaigns.find((c) => c.id === req.params.campaignId && c.projectId === req.params.projectId);
  if (!campaign) {
    res.status(404).json({ error: "评价任务不存在" });
    return;
  }
  const project = data.projects.find((p) => p.id === req.params.projectId);
  const srs = latestDoc(data, req.params.projectId, "srs");
  const sdd = latestDoc(data, req.params.projectId, "sdd");
  const format = String(req.query.format ?? "md");
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${reportFileName(campaign, "csv")}"`);
    res.send(`\ufeff${campaignCsv(campaign)}`);
    return;
  }
  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${reportFileName(campaign, "json")}"`);
    res.send(
      JSON.stringify(
        {
          project: project ? { id: project.id, name: project.name } : null,
          campaign,
          documents: {
            srs: srs ? { originalName: srs.originalName, version: srs.version, count: srs.requirements.length } : null,
            sdd: sdd ? { originalName: sdd.originalName, version: sdd.version, count: sdd.designUnits.length } : null,
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${reportFileName(campaign, "md")}"`);
  res.send(campaignMarkdown(campaign, project?.name ?? "未命名项目", { srs, sdd }));
});
