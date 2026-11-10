/**
 * 评价任务后台运行器。
 *
 * 负责预检 LLM、加载最新文档/快照、更新进度、取消任务和重启恢复。
 */

import type { Campaign } from "../types.js";
import { LlmClient } from "../llm/client.js";
import { CancelledError } from "./engine.js";
import { runAgentEvaluation } from "../agents/main-agent.js";
import { getStore, mutateStore, readSettings } from "../store.js";
import { nowIso } from "../util/id.js";

const controllers = new Map<string, AbortController>();

export function cancelCampaignRun(campaignId: string): boolean {
  const controller = controllers.get(campaignId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isCampaignRunning(campaignId: string): boolean {
  return controllers.has(campaignId);
}

/**
 * 后台启动一次评价任务。
 *
 * 负责 LLM 预检、加载最新文档/快照、写入进度、处理取消和异常。
 */
export async function startCampaignRun(campaignId: string, projectId: string): Promise<void> {
  const controller = new AbortController();
  controllers.set(campaignId, controller);

  const update = async (patch: (campaign: Campaign) => void): Promise<void> => {
    await mutateStore((data) => {
      const campaign = data.campaigns.find((c) => c.id === campaignId && c.projectId === projectId);
      if (campaign) patch(campaign);
    });
  };

  try {
    const store = await getStore();
    const campaign = store.campaigns.find((c) => c.id === campaignId && c.projectId === projectId);
    if (!campaign) throw new Error("评价任务不存在");
    const requirementsDoc = store.documents
      .filter((d) => d.projectId === projectId && d.kind === "srs")
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    const designDoc = store.documents
      .filter((d) => d.projectId === projectId && d.kind === "sdd")
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    const snapshot = store.snapshots
      .filter((s) => s.projectId === projectId && s.status === "ready")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    const settings = readSettings().llm;
    let useLlm = !settings.mock && Boolean(settings.apiKey && settings.baseUrl && settings.model);
    let client = useLlm ? new LlmClient(settings) : undefined;
    let preflightWarning = "";
    if (client) {
      try {
        await client.testConnection();
      } catch (err) {
        useLlm = false;
        client = undefined;
        preflightWarning = `LLM 连接测试失败，本次评价已回退为启发式规则：${(err as Error).message}`;
      }
    }

    await update((c) => {
      c.status = "running";
      c.phase = "preparing";
      c.startedAt = nowIso();
      c.progress = { done: 0, total: 1, message: "正在准备文档与代码索引…" };
      c.provider = useLlm ? "openai-compatible" : "heuristic";
      c.model = useLlm ? settings.model : "规则匹配";
      c.pipeline = "agent";
    });

    const result = await runAgentEvaluation({
      campaignId,
      projectId,
      levels: campaign.levels,
      subsystems: campaign.subsystems ?? [],
      requirements: requirementsDoc?.requirements ?? [],
      designUnits: designDoc?.designUnits ?? [],
      snapshot,
      client,
      concurrency: Math.max(1, Math.min(settings.concurrency || 3, 8)),
      signal: controller.signal,
      onProgress: (phase, done, total, message) => {
        void update((c) => {
          c.phase = phase;
          c.progress = { done, total, message };
        });
      },
    });

    const warnings = [...result.warnings];
    if (preflightWarning) warnings.unshift(preflightWarning);
    if (!useLlm && !preflightWarning) {
      warnings.unshift(
        settings.mock
          ? "当前为演示模式（Mock），未调用真实 LLM，评价结果来自启发式规则。"
          : "未配置可用的 LLM API Key，本次评价使用启发式规则；结果仅供初筛。",
      );
    }
    await update((c) => {
      c.status = "completed";
      c.phase = "completed";
      c.relations = result.relations;
      c.summary = result.summary;
      c.method = result.method;
      c.warnings = warnings;
      c.pipeline = "agent";
      c.agentRuns = [...(c.agentRuns ?? []), ...result.agentRuns].slice(-50);
      c.progress = { done: 1, total: 1, message: `已完成 ${result.relations.length} 条一致性判定` };
      c.finishedAt = nowIso();
    });
  } catch (err) {
    const aborted = controller.signal.aborted || err instanceof CancelledError;
    const failedRuns = (err as Error & { agentRuns?: Campaign["agentRuns"] }).agentRuns ?? [];
    await update((c) => {
      c.status = aborted ? "cancelled" : "failed";
      c.error = aborted ? "任务已取消" : (err as Error).message;
      c.finishedAt = nowIso();
      c.pipeline = "agent";
      c.agentRuns = [...(c.agentRuns ?? []), ...failedRuns].slice(-50);
      c.progress = { done: 0, total: 1, message: aborted ? "任务已取消" : "评价失败" };
    }).catch(() => undefined);
    if (!aborted) console.error("[campaign]", err);
  } finally {
    controllers.delete(campaignId);
  }
}

export function recoverInterruptedCampaigns(): void {
  void mutateStore((data) => {
    for (const campaign of data.campaigns) {
      if (campaign.status === "running" || campaign.status === "queued") {
        campaign.status = "failed";
        campaign.error = "服务重启导致任务中断，请重新创建评价。";
        campaign.finishedAt = nowIso();
        campaign.progress = { done: 0, total: 1, message: "任务中断" };
      }
    }
  });
}
