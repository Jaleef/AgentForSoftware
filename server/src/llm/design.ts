import type { DesignPoint, DesignUnit, DesignUnitType, SubsystemCategory } from "../types.js";
import type { LlmClient } from "./client.js";
import { mapLimit } from "./client.js";
import { assignDesignCodes, designUnitFromPoint } from "../parsers/design.js";
import { cleanText } from "../util/text.js";
import {
  generateSubsystemTaxonomy,
  taxonomyCategoryFor,
  type TaxonomyResult,
} from "./taxonomy.js";

interface DesignJudgement {
  pointId?: string;
  isDesignUnit?: boolean | string | number;
  confidence?: number | string;
  reason?: string;
  typeHint?: string;
}

interface GeneratedDesignFields {
  pointId?: string;
  name?: string;
  type?: string;
  summary?: string;
  obligations?: string[];
  keywords?: string[];
}

export interface DesignAgentResult {
  units: DesignUnit[];
  points: DesignPoint[];
  taxonomy: SubsystemCategory[];
  warnings: string[];
  tablePoints: number;
  databasePoints: number;
  textPoints: number;
  acceptedDatabasePoints: number;
  acceptedTextPoints: number;
  usedLlm: boolean;
}

const JUDGE_SYSTEM = `你是资深软件架构师。任务：判断每个候选是否构成一个可核验的“设计单元”。
候选有两种：
1. text：设计文档中的文本章节（可能是模块说明、接口说明、页面设计、数据设计等）；
2. database：数据库表结构（字段名称/含义/类型/长度/主键）。
判定为设计单元的条件（全部满足）：
1. 描述了系统的设计决策或可实现结构：模块/子功能、接口、数据结构、页面、输入输出、约束等；
2. 可以被代码实现或与代码比对；
3. 不是单纯的背景、目标、范围、目录、修订记录、图表说明、需求复述或空章节。
注意：数据库表若有明确字段定义，通常应视为“数据表”设计单元；页面设计章节若描述了页面功能/交互，也应视为“页面”设计单元。
只依据内容判断，不要根据章节名称推断。
只输出 JSON：
{"items":[{"pointId":"dp-0001","isDesignUnit":true,"confidence":0.9,"reason":"...","typeHint":"模块"}]}
typeHint 可为 模块/子功能/数据表/页面，无法判断可省略。`;

const GENERATE_SYSTEM = `你是资深软件架构师。任务：把每个已确认的设计点转换为结构化设计单元。
规则：
1. name、description、detail、interface、input、output、fields 是原始依据，不要改写或编造；只能使用输入内容。
2. type 必须从 模块/子功能/数据表/页面 中选择。
3. kind=table 的设计点来自结构化设计表，必须保持输入的 typeHint（模块或子功能），name 也优先保持输入 name。
4. kind=database 的设计点必须保持 type=数据表，并保留 fields。
5. 只根据文本内容判断设计类型，禁止根据章节名称推断。
6. summary 不超过 100 个汉字。
7. obligations 是 4-10 条原子设计义务，覆盖功能、接口、输入、输出、数据结构/字段与关键约束。
8. keywords 输出 5-15 个领域关键词与接口/字段标识符。
只输出 JSON：
{"items":[{"pointId":"dp-0001","name":"...","type":"模块","summary":"...","obligations":["..."],"keywords":["..."]}]}`;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function normalizeItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["items", "data", "results", "designs", "units"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
    if (typeof record.pointId === "string") return [value as T];
  }
  return [];
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["true", "yes", "1", "是"].includes(value.trim().toLowerCase());
  return false;
}

function clampConfidence(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item).replace(/^[-*·•]\s*/, ""))
    .filter((item) => item.length >= 3 && item.length <= 260)
    .slice(0, max);
}

const DESIGN_TYPES: DesignUnitType[] = ["模块", "子功能", "数据表", "页面"];

/** Stage 2: ask the LLM whether text/database candidates are design units. */
export async function judgeDesignPoints(
  points: DesignPoint[],
  client: LlmClient,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ warnings: string[]; usedLlm: boolean }> {
  const candidates = points.filter((point) => point.kind === "text" || point.kind === "database");
  const warnings: string[] = [];
  if (!candidates.length) return { warnings, usedLlm: false };

  const batches = chunks(candidates, 6);
  let usedLlm = false;
  let done = 0;
  await mapLimit(batches, Math.max(1, Math.min(concurrency, 3)), async (batch) => {
    try {
      const payload = batch.map((point) => ({
        pointId: point.id,
        kind: point.kind,
        typeHint: point.typeHint,
        name: point.name,
        description: point.description.slice(0, 1200),
        detail: point.detail.slice(0, 800),
        interface: point.interfaceText.slice(0, 600),
        input: point.input.slice(0, 300),
        output: point.output.slice(0, 300),
        fields: point.fields.slice(0, 30),
        text: point.text.slice(0, 1600),
      }));
      const response = await client.chatJson<unknown>(
        [
          { role: "system", content: JUDGE_SYSTEM },
          {
            role: "user",
            content: `待判断的候选设计点：\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      const items = normalizeItems<DesignJudgement>(response);
      for (const item of items) {
        const point = batch.find((candidate) => candidate.id === item.pointId);
        if (!point) continue;
        point.judged = true;
        point.accepted = truthy(item.isDesignUnit);
        point.confidence = clampConfidence(item.confidence, 0.7);
        point.reason = cleanText(item.reason || "");
        if (item.typeHint && DESIGN_TYPES.includes(item.typeHint as DesignUnitType)) {
          point.typeHint = item.typeHint as DesignUnitType;
        }
        usedLlm = true;
      }
    } catch (err) {
      if (warnings.length < 6) warnings.push(`设计点判定失败：${(err as Error).message}`);
    } finally {
      done++;
      onProgress?.(done, batches.length);
    }
  });
  return { warnings, usedLlm };
}

/** Stage 3: generate structured design units from accepted points. */
export async function generateDesignUnits(
  points: DesignPoint[],
  taxonomy: TaxonomyResult,
  client: LlmClient,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ units: DesignUnit[]; warnings: string[]; usedLlm: boolean }> {
  const accepted = points.filter((point) => point.judged && point.accepted);
  const warnings: string[] = [];
  if (!accepted.length) return { units: [], warnings, usedLlm: false };

  const batches = chunks(accepted, 5);
  const generated = new Map<string, GeneratedDesignFields>();
  let usedLlm = false;
  let done = 0;

  await mapLimit(batches, Math.max(1, Math.min(concurrency, 3)), async (batch) => {
    try {
      const payload = batch.map((point) => ({
        pointId: point.id,
        kind: point.kind,
        typeHint: point.typeHint,
        name: point.name,
        description: point.description.slice(0, 1000),
        detail: point.detail.slice(0, 1000),
        interface: point.interfaceText.slice(0, 800),
        input: point.input.slice(0, 400),
        output: point.output.slice(0, 400),
        fields: point.fields.slice(0, 40),
        text: point.text.slice(0, 1800),
      }));
      const response = await client.chatJson<unknown>(
        [
          { role: "system", content: GENERATE_SYSTEM },
          {
            role: "user",
            content: `设计类型枚举：${DESIGN_TYPES.join("、")}\n待转换设计点：\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      const items = normalizeItems<GeneratedDesignFields>(response);
      for (const item of items) {
        if (item.pointId && batch.some((point) => point.id === item.pointId)) {
          generated.set(item.pointId, item);
          usedLlm = true;
        }
      }
    } catch (err) {
      if (warnings.length < 6) warnings.push(`设计单元生成失败：${(err as Error).message}`);
    } finally {
      done++;
      onProgress?.(done, batches.length);
    }
  });

  const units: DesignUnit[] = accepted.map((point) => {
    const fields = generated.get(point.id);
    const subsystem = taxonomyCategoryFor(point, taxonomy.mapping);
    const type = (() => {
      if (point.kind === "database") return "数据表";
      if (point.kind === "table" && point.typeHint) return point.typeHint;
      const candidate = fields?.type as DesignUnitType | undefined;
      return candidate && DESIGN_TYPES.includes(candidate) ? candidate : point.typeHint || "模块";
    })();
    if (!fields) {
      return designUnitFromPoint(point, { subsystem, type }, "rule");
    }
    return designUnitFromPoint(
      point,
      {
        name: point.kind === "table" ? point.name : fields.name,
        type,
        subsystem,
        summary: fields.summary,
        obligations: cleanList(fields.obligations, 12),
        keywords: cleanList(fields.keywords, 18),
      },
      "llm",
    );
  });

  return { units: assignDesignCodes(units), warnings, usedLlm };
}

export async function runDesignAgent(
  docId: string,
  points: DesignPoint[],
  client: LlmClient,
  concurrency: number,
  onProgress?: (message: string) => void,
): Promise<DesignAgentResult & { documentId: string }> {
  const warnings: string[] = [];
  const tablePoints = points.filter((point) => point.kind === "table").length;
  const databasePoints = points.filter((point) => point.kind === "database").length;
  const textPoints = points.filter((point) => point.kind === "text").length;

  onProgress?.("LLM 判断文本/数据库设计候选…");
  const judgement = await judgeDesignPoints(points, client, concurrency);
  warnings.push(...judgement.warnings);

  const acceptedDatabasePoints = points.filter((point) => point.kind === "database" && point.accepted).length;
  const acceptedTextPoints = points.filter((point) => point.kind === "text" && point.accepted).length;
  const judgedCandidates = points.filter((point) => point.kind !== "table" && point.judged).length;
  if (databasePoints + textPoints > judgedCandidates) {
    warnings.push(
      `${databasePoints + textPoints - judgedCandidates} 个文本/数据库候选未得到 LLM 判定，暂未纳入设计单元。`,
    );
  }

  onProgress?.("LLM 归纳设计子系统…");
  const taxonomy = await generateSubsystemTaxonomy(
    points.filter((point) => point.judged && point.accepted),
    client,
  );
  warnings.push(...taxonomy.warnings);
  if (!taxonomy.usedLlm && points.some((point) => point.accepted)) {
    warnings.push("未成功生成设计子系统分类，设计单元将统一归入“全局”。");
  }

  onProgress?.(`LLM 生成设计单元（${points.filter((point) => point.accepted).length} 个设计点）…`);
  const generation = await generateDesignUnits(points, taxonomy, client, concurrency);
  warnings.push(...generation.warnings);

  if (!judgement.usedLlm && databasePoints + textPoints > 0) {
    warnings.push("文本/数据库设计点判定未成功，仅保留结构化设计表单元。");
  }
  if (!generation.usedLlm && points.some((point) => point.accepted)) {
    warnings.push("LLM 未能生成结构化设计单元，已使用规则回退结果。");
  }

  return {
    documentId: docId,
    units: generation.units,
    points,
    taxonomy: taxonomy.categories,
    warnings,
    tablePoints,
    databasePoints,
    textPoints,
    acceptedDatabasePoints,
    acceptedTextPoints,
    usedLlm: judgement.usedLlm || generation.usedLlm || taxonomy.usedLlm,
  };
}
