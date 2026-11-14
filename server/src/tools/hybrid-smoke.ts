/**
 * 混合检索 smoke 测试。
 *
 * 使用示例 DOCX 构建需求/设计单元，打印每条需求义务的 Top 候选与命中通道，
 * 用于验证 BM25F、RRF 以及可选向量召回是否正常。
 */

import { resolve } from "node:path";
import "../config/env.js";
import { parseDocxFile } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { buildHybridRetriever } from "../evaluation/hybrid.js";
import { findRepoRoot } from "./root.js";

const root = findRepoRoot();

async function main(): Promise<void> {
  const reqPath = process.argv[2] ?? resolve(root, "文档例子", "DT软件需求说明(V2.7.3).docx");
  const designPath = process.argv[3] ?? resolve(root, "文档例子", "DT软件设计说明(V4.0).docx");
  const requirements = parseRequirements(parseDocxFile(reqPath)).requirements;
  const designUnits = parseDesign(parseDocxFile(designPath)).designUnits;
  const retriever = await buildHybridRetriever(designUnits, requirements, {
    finalLimit: 8,
    channelLimit: 16,
  });

  console.log({
    requirements: requirements.length,
    designUnits: designUnits.length,
    denseEnabled: retriever.denseEnabled,
    warnings: retriever.warnings,
  });

  for (const requirement of requirements.slice(0, 5)) {
    console.log(`\n== ${requirement.code} ${requirement.title}`);
    for (const candidate of await retriever.rank(requirement)) {
      console.log(
        `${candidate.unit.code} ${candidate.unit.name} ` +
          `score=${candidate.score.toFixed(4)} hits=${candidate.obligationHits} ` +
          `channels=${JSON.stringify(candidate.channels)}`,
      );
    }
  }
}

void main();
