import { resolve } from "node:path";
import { parseDocxFile } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { scanCodeSnapshot } from "../parsers/code.js";
import { buildDesignIndex, buildSymbolIndex, rankCodeCandidates, rankDesignCandidates } from "../evaluation/retrieval.js";
import { findRepoRoot } from "./root.js";

const root = findRepoRoot();
const req = parseRequirements(parseDocxFile(resolve(root, "文档例子", "DT软件需求说明(V2.7.3).docx")));
const design = parseDesign(parseDocxFile(resolve(root, "文档例子", "DT软件设计说明(V4.0).docx")));
const snapshot = scanCodeSnapshot("debug", resolve(root, "examples", "demo-app"));
const designIndex = buildDesignIndex(design.designUnits);
const symbolIndex = buildSymbolIndex(snapshot);

const designCodes = process.argv.slice(2);
const targets = designCodes.length ? designCodes : ["SDD-FUN-001", "SDD-FUN-002", "SDD-FUN-005", "SDD-FUN-009", "SDD-MOD-001", "SDD-MOD-020", "SDD-DB-001", "SDD-PAGE-001"];
for (const code of targets) {
  const unit = design.designUnits.find((u) => u.code === code);
  if (!unit) {
    console.log("not found", code);
    continue;
  }
  console.log(`\n## ${unit.code} [${unit.type}] ${unit.name} | ${unit.subsystem}`);
  console.log("interface:", unit.interfaceText.slice(0, 160));
  console.log("obl:", unit.obligations.slice(0, 4).join(" / "));
  const ranked = rankCodeCandidates(unit, symbolIndex, 8);
  for (const r of ranked.slice(0, 5)) {
    console.log(`  ${r.score.toFixed(3)} ${r.symbol.kind} ${r.symbol.name} ${r.symbol.file}:${r.symbol.line}`);
  }
}

console.log("\n## requirement -> design samples");
for (const rc of ["SRS-FR-001", "SRS-FR-002", "SRS-UI-001", "SRS-DATA-001", "SRS-PERF-001", "SRS-QA-001"]) {
  const r = req.requirements.find((x) => x.code === rc);
  if (!r) continue;
  console.log(`\n### ${r.code} ${r.title}`);
  for (const c of rankDesignCandidates(r, designIndex, 5)) {
    console.log(`  ${c.score.toFixed(3)} ${c.unit.code} [${c.unit.type}] ${c.unit.name}`);
  }
}
