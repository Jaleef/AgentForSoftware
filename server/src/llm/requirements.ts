/**
 * 需求点判定与需求单元生成 Agent。
 *
 * 对文本候选做 LLM 判定，再生成需求单元、义务和关键词。
 */

import type { RequirementPoint, RequirementType, RequirementUnit, SubsystemCategory } from "../types.js";
import { REQUIREMENT_TYPES } from "../types.js";
import type { LlmClient } from "./client.js";
import { mapLimit } from "./client.js";
import {
  assignRequirementCodes,
  requirementUnitFromPoint,
} from "../parsers/requirements.js";
import { cleanText } from "../util/text.js";
import {
  resolveTaxonomy,
  taxonomyCategoryFor,
  type TaxonomyResult,
} from "./taxonomy.js";

interface TextJudgement {
  pointId?: string;
  isRequirement?: boolean | string;
  confidence?: number | string;
  reason?: string;
}

interface GeneratedFields {
  pointId?: string;
  title?: string;
  type?: string;
  summary?: string;
  obligations?: string[];
  keywords?: string[];
}

export interface RequirementAgentResult {
  units: RequirementUnit[];
  points: RequirementPoint[];
  taxonomy: SubsystemCategory[];
  warnings: string[];
  tablePoints: number;
  textPoints: number;
  acceptedTextPoints: number;
  usedLlm: boolean;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function normalizeItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["items", "data", "results", "requirements", "units"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
    if (typeof record.pointId === "string") return [value as T];
  }
  return [];
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
    .filter((item) => item.length >= 3 && item.length <= 240)
    .slice(0, max);
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["true", "yes", "1", "是"].includes(value.trim().toLowerCase());
  return false;
}

const JUDGE_SYSTEM = `你是资深需求分析师。任务：判断每一段文本是否构成一个独立、可验收的软件需求点。
判定为需求的条件（全部满足）：
1. 描述系统/软件必须提供的能力、行为、接口、数据、性能、安全、约束或交付要求；
2. 可以被设计、实现和验证；
3. 不是单纯的背景介绍、目标、范围、读者说明、术语解释、图表说明、版本记录或现状描述。
注意：一段文字可以包含多个义务，但仍作为一个需求点，不要拆成多条。
只依据文本内容判断，不要根据章节名称推断它是不是需求。
只输出 JSON：
{"items":[{"pointId":"rp-0001","isRequirement":true,"confidence":0.9,"reason":"...","typeHint":"功能需求"}]}
其中 typeHint 可选，若文本明显属于功能/性能/接口/数据/安全/环境/验收/质量属性等类型可给出，但不要强行分类。`;

const GENERATE_SYSTEM = `你是资深需求分析师。任务：把每个已确认的需求点转换为一个结构化需求单元。
规则：
1. description 和 detail 是原始依据，不要改写或编造；只能使用输入中的 description/detail/text。
2. 只根据文本内容判断需求类型，禁止根据章节名称推断。
3. type 必须从给定枚举中选择最贴近的一项，无法判断选“其他需求”。
4. title 不超过 40 个汉字；summary 不超过 80 个汉字。
5. obligations 是 4-8 条原子义务，每条一句话、以动词开头，可被设计/代码逐条核验。
6. keywords 输出 4-12 个领域关键词。
7. 不需要输出 subsystem；所属子系统由统一的分类映射决定。
只输出 JSON：
{"items":[{"pointId":"rp-0001","title":"...","type":"功能需求","summary":"...","obligations":["..."],"keywords":["..."]}]}`;

/** Stage 2: ask the LLM whether each text-only candidate is a requirement point. */
export async function judgeTextRequirementPoints(
  points: RequirementPoint[],
  client: LlmClient,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ warnings: string[]; usedLlm: boolean }> {
  const textPoints = points.filter((point) => point.kind === "text");
  const warnings: string[] = [];
  if (!textPoints.length) return { warnings, usedLlm: false };

  const batches = chunks(textPoints, 8);
  let usedLlm = false;
  let done = 0;
  await mapLimit(batches, Math.max(1, Math.min(concurrency, 8)), async (batch) => {
    try {
      const payload = batch.map((point) => ({
        pointId: point.id,
        chapter: point.chapter,
        text: point.text.slice(0, 1400),
      }));
      const response = await client.chatJson<unknown>(
        [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: `请逐条判断以下文本是否为需求点：\n${JSON.stringify(payload, null, 2)}` },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      const items = normalizeItems<TextJudgement>(response);
      for (const point of batch) {
        const item = items.find((candidate) => candidate.pointId === point.id);
        if (!item) continue;
        point.judged = true;
        point.accepted = truthy(item.isRequirement);
        point.confidence = clampConfidence(item.confidence, point.accepted ? 0.7 : 0.6);
        point.reason = cleanText(item.reason || "").slice(0, 300);
        usedLlm = true;
      }
    } catch (err) {
      if (warnings.length < 6) warnings.push(`文本需求点判定失败：${(err as Error).message}`);
    } finally {
      done++;
      onProgress?.(done, batches.length);
    }
  });
  return { warnings, usedLlm };
}

/** Stage 3: turn all accepted points into structured requirement units. */
export async function generateRequirementUnits(
  points: RequirementPoint[],
  taxonomy: TaxonomyResult,
  client: LlmClient,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ units: RequirementUnit[]; warnings: string[]; usedLlm: boolean }> {
  const accepted = points.filter((point) => point.judged && point.accepted);
  const warnings: string[] = [];
  if (!accepted.length) return { units: [], warnings, usedLlm: false };

  const batches = chunks(accepted, 6);
  const generated = new Map<string, GeneratedFields>();
  let usedLlm = false;
  let done = 0;

  await mapLimit(batches, Math.max(1, Math.min(concurrency, 8)), async (batch) => {
    try {
      const payload = batch.map((point) => ({
        pointId: point.id,
        kind: point.kind,
        origin: point.origin,
        sourceId: point.sourceId,
        parentSourceId: point.parentSourceId,
        description: point.description.slice(0, 900),
        detail: point.detail.slice(0, 900),
        text: point.text.slice(0, 1400),
        testSpec: point.testSpec.slice(0, 400),
        location: point.location,
      }));
      const response = await client.chatJson<unknown>(
        [
          { role: "system", content: GENERATE_SYSTEM },
          {
            role: "user",
            content: `需求类型枚举：${REQUIREMENT_TYPES.join("、")}\n待转换需求点：\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      const items = normalizeItems<GeneratedFields>(response);
      for (const item of items) {
        if (item.pointId && batch.some((point) => point.id === item.pointId)) {
          generated.set(item.pointId, item);
          usedLlm = true;
        }
      }
    } catch (err) {
      if (warnings.length < 6) warnings.push(`需求单元生成失败：${(err as Error).message}`);
    } finally {
      done++;
      onProgress?.(done, batches.length);
    }
  });

  const units: RequirementUnit[] = accepted.map((point) => {
    const fields = generated.get(point.id);
    const subsystem = taxonomyCategoryFor(point, taxonomy.mapping);
    if (!fields) return requirementUnitFromPoint(point, { subsystem }, "rule");
    const type = REQUIREMENT_TYPES.includes(fields.type as RequirementType)
      ? (fields.type as RequirementType)
      : "其他需求";
    return requirementUnitFromPoint(
      point,
      {
        title: fields.title,
        type,
        subsystem,
        summary: fields.summary,
        obligations: cleanList(fields.obligations, 10),
        keywords: cleanList(fields.keywords, 16),
      },
      "llm",
    );
  });

  return { units: assignRequirementCodes(units), warnings, usedLlm };
}

/** Full requirement agent: table points + text judgement + unit generation. */
export async function runRequirementAgent(
  docId: string,
  points: RequirementPoint[],
  client: LlmClient,
  concurrency: number,
  onProgress?: (message: string) => void,
): Promise<RequirementAgentResult & { documentId: string }> {
  const warnings: string[] = [];
  const tablePoints = points.filter((point) => point.kind === "table").length;
  const textPoints = points.filter((point) => point.kind === "text").length;

  onProgress?.("LLM 判断文本型需求点…");
  const judgement = await judgeTextRequirementPoints(points, client, concurrency);
  warnings.push(...judgement.warnings);

  const judgedTextPoints = points.filter((point) => point.kind === "text" && point.judged).length;
  if (textPoints > 0 && judgedTextPoints < textPoints) {
    warnings.push(`${textPoints - judgedTextPoints} 个文本候选未得到 LLM 判定，暂未纳入需求单元。`);
  }
  const acceptedTextPoints = points.filter((point) => point.kind === "text" && point.accepted).length;
  onProgress?.("归纳子系统类别…");
  const acceptedPoints = points.filter((point) => point.judged && point.accepted);
  const taxonomy = await resolveTaxonomy(acceptedPoints, client);
  warnings.push(...taxonomy.warnings);
  if (taxonomy.source === "none" && points.some((point) => point.accepted)) {
    warnings.push("未能生成子系统分类，需求单元将统一归入“全局”。");
  }

  onProgress?.(`LLM 生成需求单元（${points.filter((p) => p.accepted).length} 个需求点）…`);
  const generation = await generateRequirementUnits(points, taxonomy, client, concurrency);
  warnings.push(...generation.warnings);

  if (!judgement.usedLlm && textPoints > 0) {
    warnings.push("文本型需求点判定未成功，文本章节暂未纳入需求单元；需求表部分仍已保留。");
  }
  if (!generation.usedLlm && points.some((p) => p.accepted)) {
    warnings.push("LLM 未能生成结构化需求单元，已使用规则回退结果。");
  }

  return {
    documentId: docId,
    units: generation.units,
    points,
    taxonomy: taxonomy.categories,
    warnings,
    tablePoints,
    textPoints,
    acceptedTextPoints,
    usedLlm: judgement.usedLlm || generation.usedLlm || taxonomy.usedLlm,
  };
}


