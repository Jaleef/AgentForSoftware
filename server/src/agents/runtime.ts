/**
 * 子 Agent 运行器。
 *
 * 统一处理计时、调用预算、取消、AgentRun 审计和失败记录。
 */

import { newId, nowIso, sha256 } from "../util/id.js";
import type { AgentRun } from "../types.js";
import type { AgentContext, AgentResult, SubAgent } from "./contracts.js";

function inputHash(input: unknown): string {
  try {
    return sha256(JSON.stringify(input)).slice(0, 16);
  } catch {
    return "";
  }
}

function isCancelled(context: AgentContext): boolean {
  return context.signal.aborted;
}

/**
 * 执行一个子 Agent，并把执行记录追加到 context.agentRuns。
 *
 * 子 Agent 不直接写 store；调用方在主 Agent 中决定持久化。
 */
export async function runSubAgent<I, O>(
  agent: SubAgent<I, O>,
  input: I,
  context: AgentContext,
): Promise<AgentResult<O>> {
  if (isCancelled(context)) throw new Error("任务已取消");
  if (Date.now() - context.budget.startedAt > context.budget.maxDurationMs) {
    throw new Error("任务超过最大执行时长，已停止后续 Agent。");
  }
  context.client?.setMaxCalls(context.budget.maxLlmCalls);

  const callsBefore = context.client?.calls ?? 0;
  const startedAt = nowIso();
  const record: AgentRun = {
    id: newId("run"),
    agent: agent.name,
    version: agent.version,
    stage: agent.stage,
    status: "running",
    startedAt,
    model: context.client?.model,
    inputHash: inputHash(input),
    warnings: [],
  };
  context.agentRuns.push(record);
  context.logger.info(`${agent.name} started`);

  try {
    const result = await agent.run(input, context);
    record.status = "completed";
    record.warnings = result.warnings ?? [];
    record.finishedAt = nowIso();
    record.outputSummary = result.summary;
    record.metrics = {
      llmCalls: (context.client?.calls ?? 0) - callsBefore,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    };
    context.logger.info(`${agent.name} completed`);
    return result;
  } catch (error) {
    record.status = context.signal.aborted ? "skipped" : "failed";
    record.finishedAt = nowIso();
    record.error = (error as Error).message;
    record.metrics = {
      llmCalls: (context.client?.calls ?? 0) - callsBefore,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    };
    context.logger.warn(`${agent.name} failed: ${(error as Error).message}`);
    throw error;
  }
}
