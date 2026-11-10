/**
 * 需求→设计判定子 Agent。
 *
 * 封装义务级混合检索、LLM 覆盖判定和覆盖矩阵聚合。
 */

import type { DesignUnit, RequirementUnit } from "../../types.js";
import type { LlmClient } from "../../llm/client.js";
import { runEvaluation, type EvaluationResult } from "../../evaluation/engine.js";
import type { AgentContext, AgentResult, SubAgent } from "../contracts.js";

export interface RequirementDesignInput {
  requirements: RequirementUnit[];
  designUnits: DesignUnit[];
  client?: LlmClient;
  concurrency: number;
}

export class RequirementDesignJudgeAgent
  implements SubAgent<RequirementDesignInput, EvaluationResult>
{
  name = "requirement-design-judge";
  version = "1.0.0";
  stage = "requirement_design";

  async run(input: RequirementDesignInput, context: AgentContext): Promise<AgentResult<EvaluationResult>> {
    if (context.signal.aborted) throw new Error("任务已取消");
    const result = await runEvaluation({
      levels: ["requirement_design"],
      subsystems: [],
      requirements: input.requirements,
      designUnits: input.designUnits,
      client: input.client,
      concurrency: input.concurrency,
      signal: context.signal,
      onProgress: (phase, done, total, message) =>
        context.progress(phase, done, total, message),
    });
    return {
      data: result,
      warnings: result.warnings,
      summary: `${result.relations.length} 条需求→设计关系`,
    };
  }
}
