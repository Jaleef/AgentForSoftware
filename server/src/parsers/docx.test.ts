import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocxBuffer } from "../parsers/docx.js";
import { parseRequirements } from "../parsers/requirements.js";
import { parseDesign } from "../parsers/design.js";
import { generateHeuristicTaxonomy } from "../llm/taxonomy.js";

const root = process.cwd();
const reqPath = resolve(root, "文档例子", "DT软件需求说明(V2.7.3).docx");
const designPath = resolve(root, "文档例子", "DT软件设计说明(V4.0).docx");

describe("DOCX parser regression", () => {
  it("parses the requirements document without changing rule counts", () => {
    const doc = parseDocxBuffer(readFileSync(reqPath));
    const parsed = parseRequirements(doc);
    expect(doc.pageCount).toBe(63);
    expect(doc.paragraphs.length).toBe(581);
    expect(doc.tables.length).toBe(90);
    expect(parsed.requirementPoints.length).toBe(189);
    expect(parsed.requirements.length).toBe(86);
  });

  it("parses the design document without changing rule counts", () => {
    const doc = parseDocxBuffer(readFileSync(designPath));
    const parsed = parseDesign(doc);
    expect(doc.pageCount).toBe(247);
    expect(doc.paragraphs.length).toBe(1618);
    expect(doc.tables.length).toBe(109);
    expect(parsed.designPoints.length).toBe(176);
  });

  it("builds deterministic taxonomy from chapter paths", () => {
    const doc = parseDocxBuffer(readFileSync(reqPath));
    const parsed = parseRequirements(doc);
    const accepted = parsed.requirementPoints.filter((point) => point.judged && point.accepted);
    const taxonomy = generateHeuristicTaxonomy(accepted);
    expect(taxonomy.source).toBe("heuristic");
    expect(taxonomy.categories.length).toBeGreaterThan(0);
    expect(taxonomy.categories.length).toBeLessThanOrEqual(9);
    expect(taxonomy.mapping.size).toBeGreaterThan(0);
  });
});
