/**
 * 子系统分类子 Agent。
 *
 * 独立包装章节路径到子系统类别的 LLM 归纳，便于其他流程复用。
 */

import type { LlmClient } from "../../llm/client.js";
import {
  generateSubsystemTaxonomy,
  type TaxonomyPoint,
  type TaxonomyResult,
} from "../../llm/taxonomy.js";
import type { AgentContext, AgentResult, SubAgent } from "../contracts.js";

export interface TaxonomyInput {
  points: TaxonomyPoint[];
  client: LlmClient;
}

export class TaxonomyAgent implements SubAgent<TaxonomyInput, TaxonomyResult> {
  name = "taxonomy";
  version = "1.0.0";
  stage = "taxonomy";

  async run(input: TaxonomyInput, context: AgentContext): Promise<AgentResult<TaxonomyResult>> {
    context.progress("taxonomy", 0, 1, "归纳子系统类别…");
    const result = await generateSubsystemTaxonomy(input.points, input.client);
    return {
      data: result,
      warnings: result.warnings,
      summary: `子系统类别 ${result.categories.length} 个`,
    };
  }
}
