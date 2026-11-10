/**
 * 需求拆分子 Agent。
 *
 * 包装现有需求点判定 + 子系统分类 + 需求单元生成，不直接写存储。
 */

import type { RequirementPoint } from "../../types.js";
import type { LlmClient } from "../../llm/client.js";
import { runRequirementAgent, type RequirementAgentResult } from "../../llm/requirements.js";
import type { AgentContext, AgentResult, SubAgent } from "../contracts.js";

export interface RequirementSplitInput {
  documentId: string;
  points: RequirementPoint[];
  client: LlmClient;
  concurrency: number;
}

export class RequirementSplitAgent
  implements SubAgent<RequirementSplitInput, RequirementAgentResult & { documentId: string }>
{
  name = "requirement-split";
  version = "1.0.0";
  stage = "requirement_split";

  async run(
    input: RequirementSplitInput,
    context: AgentContext,
  ): Promise<AgentResult<RequirementAgentResult & { documentId: string }>> {
    context.progress("requirement_split", 0, 1, "LLM 判断需求点并生成需求单元…");
    const result = await runRequirementAgent(
      input.documentId,
      input.points,
      input.client,
      input.concurrency,
      (message) => context.progress("requirement_split", 0, 1, message),
    );
    return {
      data: result,
      warnings: result.warnings,
      summary: `需求单元 ${result.units.length} 个，子系统 ${result.taxonomy.length} 个`,
    };
  }
}
