/**
 * 设计→代码判定子 Agent。
 *
 * 封装代码符号检索、LLM 判定和关系生成。
 */

import type { CodeSnapshot, DesignUnit } from "../../types.js";
import type { LlmClient } from "../../llm/client.js";
import { runEvaluation, type EvaluationResult } from "../../evaluation/engine.js";
import type { AgentContext, AgentResult, SubAgent } from "../contracts.js";

export interface DesignCodeInput {
  designUnits: DesignUnit[];
  snapshot?: CodeSnapshot;
  client?: LlmClient;
  concurrency: number;
}

export class DesignCodeJudgeAgent implements SubAgent<DesignCodeInput, EvaluationResult> {
  name = "design-code-judge";
  version = "1.0.0";
  stage = "design_code";

  async run(input: DesignCodeInput, context: AgentContext): Promise<AgentResult<EvaluationResult>> {
    if (context.signal.aborted) throw new Error("任务已取消");
    if (!input.snapshot) throw new Error("尚未登记代码快照，无法执行设计→代码评价。");
    const result = await runEvaluation({
      levels: ["design_code"],
      subsystems: [],
      requirements: [],
      designUnits: input.designUnits,
      snapshot: input.snapshot,
      client: input.client,
      concurrency: input.concurrency,
      signal: context.signal,
      onProgress: (phase, done, total, message) =>
        context.progress(phase, done, total, message),
    });
    return {
      data: result,
      warnings: result.warnings,
      summary: `${result.relations.length} 条设计→代码关系`,
    };
  }
}
