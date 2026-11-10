/**
 * 设计拆分子 Agent。
 *
 * 包装现有设计点判定 + 子系统分类 + 设计单元生成，不直接写存储。
 */

import type { DesignPoint } from "../../types.js";
import type { LlmClient } from "../../llm/client.js";
import { runDesignAgent, type DesignAgentResult } from "../../llm/design.js";
import type { AgentContext, AgentResult, SubAgent } from "../contracts.js";

export interface DesignSplitInput {
  documentId: string;
  points: DesignPoint[];
  client: LlmClient;
  concurrency: number;
}

export class DesignSplitAgent implements SubAgent<DesignSplitInput, DesignAgentResult & { documentId: string }> {
  name = "design-split";
  version = "1.0.0";
  stage = "design_split";

  async run(
    input: DesignSplitInput,
    context: AgentContext,
  ): Promise<AgentResult<DesignAgentResult & { documentId: string }>> {
    context.progress("design_split", 0, 1, "LLM 判断设计点并生成设计单元…");
    const result = await runDesignAgent(
      input.documentId,
      input.points,
      input.client,
      input.concurrency,
      (message) => context.progress("design_split", 0, 1, message),
    );
    return {
      data: result,
      warnings: result.warnings,
      summary: `设计单元 ${result.units.length} 个，子系统 ${result.taxonomy.length} 个`,
    };
  }
}
