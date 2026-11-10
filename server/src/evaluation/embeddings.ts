/**
 * 可选的 OpenAI 兼容 Embedding 客户端。
 *
 * 通过 EMBEDDING_* 环境变量启用；未配置或调用失败时，混合检索自动退回
 * BM25F + 词面通道，不影响现有评价流程。
 */

import { sha256 } from "../util/id.js";

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  batchSize: number;
  timeoutMs: number;
}

const cache = new Map<string, number[]>();

/**
 * 从环境变量读取 embedding 配置。
 *
 * 未设置 `EMBEDDING_MODEL` 或缺少 base/key 时返回 undefined，检索层会退回 BM25F。
 */
export function embeddingConfig(): EmbeddingConfig | undefined {
  const model = (process.env.EMBEDDING_MODEL ?? "").trim();
  if (!model) return undefined;
  const baseUrl = (process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL ?? "").trim();
  const apiKey = (process.env.EMBEDDING_API_KEY ?? process.env.LLM_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return undefined;
  const batchSize = Math.max(1, Math.min(128, Number(process.env.EMBEDDING_BATCH_SIZE ?? 32) || 32));
  const timeoutMs = Math.max(5000, Number(process.env.EMBEDDING_TIMEOUT_MS ?? 60000) || 60000);
  return { baseUrl, apiKey, model, batchSize, timeoutMs };
}

/** 是否存在可用的 embedding 配置。 */
export function isEmbeddingConfigured(): boolean {
  return Boolean(embeddingConfig());
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/embeddings") ? base : `${base}/embeddings`;
}

function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function cacheKey(config: EmbeddingConfig, text: string): string {
  return `${config.baseUrl}|${config.model}|${sha256(text)}`;
}

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
}

async function requestBatch(config: EmbeddingConfig, batch: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: batch }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 400);
      try {
        const parsed = JSON.parse(text) as EmbeddingResponse;
        message = parsed.error?.message ?? message;
      } catch {
        /* keep raw */
      }
      throw new Error(`Embedding 请求失败（HTTP ${response.status}）：${message}`);
    }
    const parsed = JSON.parse(text) as EmbeddingResponse;
    const data = parsed.data ?? [];
    const result: number[][] = new Array(batch.length);
    const indexed = data.every((entry) => typeof entry.index === "number");
    for (let index = 0; index < batch.length; index++) {
      const item = indexed
        ? data.find((entry) => entry.index === index)
        : data[index];
      if (!item?.embedding?.length) throw new Error(`Embedding 返回缺少第 ${index} 条向量`);
      result[index] = normalize(item.embedding);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed a list of texts, preserving input order.
 *
 * Returns undefined when embeddings are disabled. Throws on network/API errors
 * so callers can fall back to lexical retrieval for the whole evaluation.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | undefined> {
  const config = embeddingConfig();
  if (!config) return undefined;
  if (!texts.length) return [];

  const unique = [...new Set(texts)];
  const missing = unique.filter((text) => !cache.has(cacheKey(config, text)));
  for (let i = 0; i < missing.length; i += config.batchSize) {
    const batch = missing.slice(i, i + config.batchSize);
    const vectors = await requestBatch(config, batch);
    batch.forEach((text, index) => cache.set(cacheKey(config, text), vectors[index]));
  }
  return texts.map((text) => cache.get(cacheKey(config, text)) as number[]);
}

/** 清空进程内 embedding 缓存，供测试或配置切换使用。 */
export function clearEmbeddingCache(): void {
  cache.clear();
}
