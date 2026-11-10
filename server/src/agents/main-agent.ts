/**
 * 主 Agent：评价任务编排。
 *
 * 主 Agent 只负责拆分阶段、调用子 Agent、合并结果和计算汇总；
 * 检索、覆盖聚合、评分仍是确定性代码。
 */

import type {
  AgentRun,
  CampaignSummary,
  CodeSnapshot,
  DesignUnit,
  RequirementUnit,
  Relation,
  RelationLevel,
} from "../types.js";
import type { LlmClient } from "../llm/client.js";
import { newId } from "../util/id.js";
import { computeSummary } from "../evaluation/summary.js";
import { runSubAgent } from "./runtime.js";
import { createAgentContext } from "./context.js";
import { RequirementDesignJudgeAgent } from "./subagents/requirement-design.agent.js";
import { DesignCodeJudgeAgent } from "./subagents/design-code.agent.js";

export interface EvaluationTask {
  campaignId?: string;
  projectId: string;
  levels: RelationLevel[];
  subsystems: string[];
  requirements: RequirementUnit[];
  designUnits: DesignUnit[];
  snapshot?: CodeSnapshot;
  client?: LlmClient;
  concurrency: number;
  signal?: AbortSignal;
  onProgress?: (phase: string, done: number, total: number, message: string) => void;
}

export interface AgentEvaluationResult {
  relations: Relation[];
  summary: CampaignSummary;
  warnings: string[];
  usedLlm: boolean;
  method: "llm" | "heuristic";
  agentRuns: AgentRun[];
}

/**
 * 执行一次两层级评价。
 *
 * 每个层级的子 Agent 独立完成检索 + LLM 判定；主 Agent 合并关系后
 * 用 `computeSummary` 重新计算全链路得分，保证与旧口径一致。
 */
export async function runAgentEvaluation(task: EvaluationTask): Promise<AgentEvaluationResult> {
  const subsystemSet = task.subsystems.length ? new Set(task.subsystems) : null;
  const requirements = subsystemSet
    ? task.requirements.filter((item) => subsystemSet.has(item.subsystem))
    : task.requirements;
  const designUnits = subsystemSet
    ? task.designUnits.filter((item) => subsystemSet.has(item.subsystem))
    : task.designUnits;

  const context = createAgentContext({
    taskId: newId("task"),
    projectId: task.projectId,
    campaignId: task.campaignId,
    client: task.client,
    signal: task.signal,
    progress: task.onProgress ?? (() => undefined),
    maxLlmCalls: 500,
  });

  const relations: Relation[] = [];
  const warnings: string[] = [];
  let usedLlm = false;

  try {
    if (task.levels.includes("requirement_design")) {
      const agent = new RequirementDesignJudgeAgent();
      const result = await runSubAgent(
        agent,
        {
          requirements,
          designUnits,
          client: task.client,
          concurrency: task.concurrency,
        },
        context,
      );
      relations.push(...result.data.relations);
      warnings.push(...result.warnings);
      usedLlm ||= result.data.usedLlm;
    }

    if (task.levels.includes("design_code")) {
      const agent = new DesignCodeJudgeAgent();
      const result = await runSubAgent(
        agent,
        {
          designUnits,
          snapshot: task.snapshot,
          client: task.client,
          concurrency: task.concurrency,
        },
        context,
      );
      relations.push(...result.data.relations);
      warnings.push(...result.warnings);
      usedLlm ||= result.data.usedLlm;
    }
  } catch (error) {
    (error as Error & { agentRuns?: AgentRun[] }).agentRuns = context.agentRuns;
    throw error;
  }

  const summary = computeSummary(relations, designUnits, requirements.length);
  return {
    relations,
    summary,
    warnings: [...new Set(warnings)],
    usedLlm,
    method: usedLlm ? "llm" : "heuristic",
    agentRuns: context.agentRuns,
  };
}
