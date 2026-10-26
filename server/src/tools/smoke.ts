import { resolve } from "node:path";
import { parseDocxFile } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { scanCodeSnapshot } from "../parsers/code.js";
import { findRepoRoot } from "./root.js";

const root = findRepoRoot();

function main(): void {
  const reqPath = process.argv[2] ?? resolve(root, "文档例子", "DT软件需求说明(V2.7.3).docx");
  const designPath = process.argv[3] ?? resolve(root, "文档例子", "DT软件设计说明(V4.0).docx");

  console.log("== 需求文档 ==", reqPath);
  const reqDoc = parseDocxFile(reqPath);
  const reqs = parseRequirements(reqDoc);
  console.log({
    pages: reqs.pageCount,
    paragraphs: reqDoc.paragraphs.length,
    tables: reqDoc.tables.length,
    requirements: reqs.requirements.length,
    byType: reqs.stats.byType,
    bySubsystem: reqs.stats.bySubsystem,
    warnings: reqs.warnings,
  });
  console.log("样例：", reqs.requirements.slice(0, 3).map((r) => ({
    code: r.code,
    type: r.type,
    subsystem: r.subsystem,
    title: r.title,
    page: r.location.page,
    line: r.location.line,
    obligations: r.obligations.length,
  })));
  const missingType = reqs.requirements.filter((r) => r.type === "其他需求");
  console.log("其他需求数量：", missingType.length, missingType.slice(0, 5).map((r) => r.title));

  console.log("\n== 设计文档 ==", designPath);
  const designDoc = parseDocxFile(designPath);
  const design = parseDesign(designDoc);
  console.log({
    pages: design.pageCount,
    paragraphs: designDoc.paragraphs.length,
    tables: designDoc.tables.length,
    units: design.designUnits.length,
    byType: design.stats.byType,
    bySubsystem: design.stats.bySubsystem,
    warnings: design.warnings,
  });
  console.log("样例：", design.designUnits.slice(0, 5).map((u) => ({
    code: u.code,
    type: u.type,
    name: u.name,
    sourceId: u.sourceId,
    subsystem: u.subsystem,
    page: u.location.page,
    fields: u.fields.length,
    obligations: u.obligations.length,
  })));
  console.log("数据表样例：", design.designUnits.filter((u) => u.type === "数据表").slice(0, 3).map((u) => ({
    code: u.code,
    name: u.name,
    fields: u.fields.length,
    subsystem: u.subsystem,
  })));
  console.log("页面样例：", design.designUnits.filter((u) => u.type === "页面").map((u) => u.name));

  const demo = resolve(root, "examples", "demo-app");
  console.log("\n== 代码快照 ==", demo);
  try {
    const snapshot = scanCodeSnapshot("smoke", demo);
    console.log({
      files: snapshot.stats.files,
      lines: snapshot.stats.lines,
      symbols: snapshot.stats.symbols,
      routes: snapshot.stats.routes,
      models: snapshot.stats.models,
      byLanguage: snapshot.stats.byLanguage,
    });
    console.log("符号样例：", snapshot.files.flatMap((f) => f.symbols).slice(0, 8).map((s) => `${s.kind} ${s.name} @${s.file}:${s.line}`));
  } catch (err) {
    console.log("代码快照跳过：", (err as Error).message);
  }
}

main();
