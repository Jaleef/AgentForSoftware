import type { DesignUnit, RequirementType, RequirementUnit, StoredDocument } from "../types.js";
import { REQUIREMENT_TYPES } from "../types.js";
import { mapLimit, type LlmClient } from "./client.js";
import { cleanText } from "../util/text.js";

interface RequirementEnrichment {
  code?: string;
  type?: string;
  summary?: string;
  obligations?: string[];
  keywords?: string[];
  confidence?: number;
}

interface DesignEnrichment {
  code?: string;
  summary?: string;
  obligations?: string[];
  keywords?: string[];
  confidence?: number;
}

export interface EnrichProgress {
  done: number;
  total: number;
  message: string;
}

export interface EnrichResult {
  updated: number;
  failedBatches: number;
  warnings: string[];
}

function normalizeItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["items", "data", "results", "requirements", "designs"]) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
    // Single object with a code.
    if (typeof record.code === "string") return [value as T];
  }
  return [];
}

function clampConfidence(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return Math.min(1, n / 100);
  return Math.max(0, Math.min(1, n));
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => cleanText(v).replace(/^[-*·•]\s*/, ""))
    .filter((v) => v.length >= 3 && v.length <= 240)
    .slice(0, max);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const REQUIREMENT_SYSTEM = `你是资深软件质量工程师，正在构建"需求→设计一致性"评价知识库。
任务：把每条软件需求拆分为可逐条验证的原子义务，做需求类型分类，并给出简短摘要。
规则：
1. 只依据输入文本，不臆造文档之外的功能、接口或数据。
2. obligations 是 4-8 条原子义务，每条一句话、以动词开头，可独立核验（例如"提供按名称/类型检索模型的能力"）。
3. summary 不超过 80 个汉字，说明这条需求要求系统做什么。
4. type 必须从给定枚举中选取最贴近的一项。
5. keywords 输出 5-12 个领域关键词，优先专有名词与动作短语。
6. confidence 为 0-1 的数字，表示拆分与分类的把握。
只输出 JSON：{"items":[{"code":"...","type":"...","summary":"...","obligations":["..."],"keywords":["..."],"confidence":0.9}]}`;

const DESIGN_SYSTEM = `你是资深软件架构师，正在构建"设计→代码实现一致性"评价知识库。
任务：把每个设计单元拆分为可逐条核验的原子设计义务，并给出简短摘要。
规则：
1. 只依据输入文本，不臆造设计之外的接口、字段或行为。
2. obligations 是 4-10 条原子设计义务，覆盖：提供的功能/接口、关键输入、关键输出、数据结构、约束条件。
3. 接口文本中的函数签名、路由或参数应被保留在义务中，便于与代码检索比对。
4. summary 不超过 100 个汉字。
5. keywords 输出 5-15 个领域关键词与接口/字段标识符。
6. confidence 为 0-1 的数字，表示拆分与摘要的把握。
只输出 JSON：{"items":[{"code":"...","summary":"...","obligations":["..."],"keywords":["..."],"confidence":0.9}]}`;

export async function enrichRequirements(
  units: RequirementUnit[],
  client: LlmClient,
  concurrency: number,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  const result: EnrichResult = { updated: 0, failedBatches: 0, warnings: [] };
  const batches = chunks(units, 8);
  let done = 0;
  await mapLimit(batches, Math.min(concurrency, 3), async (batch) => {
    const payload = batch.map((u) => ({
      code: u.code,
      currentType: u.type,
      subsystem: u.subsystem,
      title: u.title,
      description: u.description.slice(0, 900),
      detail: u.detail.slice(0, 900),
      chapter: u.chapter,
    }));
    try {
      const response = await client.chatJson<unknown>(
        [
          { role: "system", content: REQUIREMENT_SYSTEM },
          {
            role: "user",
            content: `需求类型枚举：${REQUIREMENT_TYPES.join("、")}\n待处理需求：\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      const items = normalizeItems<RequirementEnrichment>(response);
      for (const item of items) {
        const unit = batch.find((u) => u.code === item.code);
        if (!unit) continue;
        const type = REQUIREMENT_TYPES.includes(item.type as RequirementType) ? (item.type as RequirementType) : undefined;
        const summary = typeof item.summary === "string" ? cleanText(item.summary).slice(0, 160) : "";
        const obligations = cleanList(item.obligations, 10);
        const keywords = cleanList(item.keywords, 16);
        let changed = false;
        if (type && type !== unit.type) {
          unit.type = type;
          changed = true;
        }
        if (summary.length >= 6) {
          unit.summary = summary;
          changed = true;
        }
        if (obligations.length >= 2) {
          unit.obligations = obligations;
          changed = true;
        }
        if (keywords.length >= 3) {
          unit.keywords = keywords;
          changed = true;
        }
        if (changed) {
          unit.origin = "llm";
          unit.confidence = clampConfidence(item.confidence, unit.confidence);
          result.updated++;
        }
      }
    } catch (err) {
      result.failedBatches++;
      if (result.warnings.length < 4) result.warnings.push(`需求摘要批次失败：${(err as Error).message}`);
    } finally {
      done++;
      onProgress?.({ done, total: batches.length, message: `LLM 整理需求：${done}/${batches.length} 批` });
    }
  });
  return result;
}

export async function enrichDesign(
  units: DesignUnit[],
  client: LlmClient,
  concurrency: number,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  const result: EnrichResult = { updated: 0, failedBatches: 0, warnings: [] };
  const batches = chunks(units, 6);
  let done = 0;
  await mapLimit(batches, Math.min(concurrency, 3), async (batch) => {
    const payload = batch.map((u) => ({
      code: u.code,
      type: u.type,
      subsystem: u.subsystem,
      name: u.name,
      description: u.description.slice(0, 900),
      interface: u.interfaceText.slice(0, 900),
      input: u.input.slice(0, 400),
      output: u.output.slice(0, 400),
      fields: u.fields.slice(0, 40).map((f) => `${f.name}:${f.meaning || f.type}`),
      chapter: u.chapter,
    }));
    try {
      const response = await client.chatJson<unknown>(
        [
          { role: "system", content: DESIGN_SYSTEM },
          { role: "user", content: `待处理设计单元：\n${JSON.stringify(payload, null, 2)}` },
        ],
        { temperature: 0.1, maxTokens: 4096 },
      );
      const items = normalizeItems<DesignEnrichment>(response);
      for (const item of items) {
        const unit = batch.find((u) => u.code === item.code);
        if (!unit) continue;
        const summary = typeof item.summary === "string" ? cleanText(item.summary).slice(0, 200) : "";
        const obligations = cleanList(item.obligations, 12);
        const keywords = cleanList(item.keywords, 20);
        let changed = false;
        if (summary.length >= 6) {
          unit.summary = summary;
          changed = true;
        }
        if (obligations.length >= 2) {
          unit.obligations = obligations;
          changed = true;
        }
        if (keywords.length >= 3) {
          unit.keywords = keywords;
          changed = true;
        }
        if (changed) {
          unit.origin = "llm";
          unit.confidence = clampConfidence(item.confidence, unit.confidence);
          result.updated++;
        }
      }
    } catch (err) {
      result.failedBatches++;
      if (result.warnings.length < 4) result.warnings.push(`设计摘要批次失败：${(err as Error).message}`);
    } finally {
      done++;
      onProgress?.({ done, total: batches.length, message: `LLM 整理设计：${done}/${batches.length} 批` });
    }
  });
  return result;
}

export async function enrichDocument(
  doc: StoredDocument,
  client: LlmClient,
  concurrency: number,
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  if (doc.kind === "srs") return enrichRequirements(doc.requirements, client, concurrency, onProgress);
  return enrichDesign(doc.designUnits, client, concurrency, onProgress);
}
