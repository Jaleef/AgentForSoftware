/**
 * 主/子 Agent smoke 测试。
 *
 * 用示例需求/设计文档跑一次无 LLM 的需求→设计评价，打印关系数、状态和 AgentRun。
 */

import { resolve } from "node:path";
import { parseDocxFile } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { runAgentEvaluation } from "../agents/main-agent.js";
import { runEvaluation } from "../evaluation/engine.js";
import { findRepoRoot } from "./root.js";

const root = findRepoRoot();

async function main(): Promise<void> {
  const reqPath = process.argv[2] ?? resolve(root, "文档例子", "DT软件需求说明(V2.7.3).docx");
  const designPath = process.argv[3] ?? resolve(root, "文档例子", "DT软件设计说明(V4.0).docx");
  const requirements = parseRequirements(parseDocxFile(reqPath)).requirements;
  const designUnits = parseDesign(parseDocxFile(designPath)).designUnits;
  const result = await runAgentEvaluation({
    projectId: "smoke",
    levels: ["requirement_design"],
    subsystems: [],
    requirements,
    designUnits,
    concurrency: 3,
    onProgress: (phase, done, total, message) => {
      if (done === 0 || done === total) console.log(`[${phase}] ${done}/${total} ${message}`);
    },
  });

  const legacy = await runEvaluation({
    levels: ["requirement_design"],
    subsystems: [],
    requirements,
    designUnits,
    concurrency: 3,
    onProgress: () => undefined,
  });
  const statusOf = (relations: typeof result.relations): string =>
    relations.map((relation) => `${relation.sourceCode}:${relation.status}`).sort().join("|");

  console.log({
    relations: result.relations.length,
    legacyRelations: legacy.relations.length,
    sameStatuses: statusOf(result.relations) === statusOf(legacy.relations),
    method: result.method,
    statuses: result.summary.counts,
    warnings: result.warnings.length,
    agentRuns: result.agentRuns.map((run) => ({
      agent: run.agent,
      status: run.status,
      llmCalls: run.metrics?.llmCalls,
      durationMs: run.metrics?.durationMs,
    })),
  });
}

void main();
