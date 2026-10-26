import { resolve } from "node:path";
import { parseDocxFile } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { scanCodeSnapshot } from "../parsers/code.js";
import { runEvaluation } from "../evaluation/engine.js";
import { findRepoRoot } from "./root.js";

const root = findRepoRoot();
const req = parseRequirements(parseDocxFile(resolve(root, "文档例子", "DT软件需求说明(V2.7.3).docx")));
const design = parseDesign(parseDocxFile(resolve(root, "文档例子", "DT软件设计说明(V4.0).docx")));
const snapshot = scanCodeSnapshot("debug", resolve(root, "examples", "demo-app"));

const result = await runEvaluation({
  levels: ["requirement_design", "design_code"],
  subsystems: [],
  requirements: req.requirements,
  designUnits: design.designUnits,
  snapshot,
  concurrency: 2,
  onProgress: (phase, done, total, message) => {
    if (done === 0 || done === total) console.log(`[${phase}] ${done}/${total} ${message}`);
  },
});

console.log("\nSUMMARY", JSON.stringify(result.summary, null, 2));
console.log("\nby type:", result.summary.byType.map((b) => `${b.key} ${b.score} (${b.total})`).join(" | "));
for (const level of ["requirement_design", "design_code"] as const) {
  const list = result.relations.filter((r) => r.level === level);
  console.log(`\n## ${level}`);
  for (const status of ["satisfied", "partial", "missing"]) {
    const items = list.filter((r) => r.status === status);
    console.log(`${status}: ${items.length}`, items.slice(0, 6).map((r) => `${r.sourceCode} ${r.sourceName} -> ${r.targetNames[0] ?? ""} (${r.confidence})`));
  }
}
