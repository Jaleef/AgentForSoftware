/**
 * 可选的 Cross-Encoder/重排服务客户端。
 *
 * 通过 RERANK_* 环境变量启用；未配置时混合检索直接使用 RRF + 结构重排。
 * 请求采用通用的 { model, query, documents, top_n } / results 接口。
 */

export interface RerankConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface RerankResult {
  index: number;
  score: number;
}

export function rerankConfig(): RerankConfig | undefined {
  const model = (process.env.RERANK_MODEL ?? "").trim();
  const baseUrl = (process.env.RERANK_BASE_URL ?? "").trim();
  if (!model || !baseUrl) return undefined;
  return {
    baseUrl,
    apiKey: (process.env.RERANK_API_KEY ?? "").trim(),
    model,
    timeoutMs: Math.max(5000, Number(process.env.RERANK_TIMEOUT_MS ?? 60000) || 60000),
  };
}

export function isRerankConfigured(): boolean {
  return Boolean(rerankConfig());
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/rerank") ? base : `${base}/rerank`;
}

interface RerankResponse {
  results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
  error?: { message?: string };
}

/**
 * 对候选文档做 Cross-Encoder 重排。
 *
 * 返回按分数降序的原始候选下标；调用失败抛错，由检索层回退到 RRF 结果。
 */
export async function rerankCandidates(
  query: string,
  documents: string[],
  topN: number,
): Promise<RerankResult[]> {
  const config = rerankConfig();
  if (!config) return [];
  if (!documents.length) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        query,
        documents,
        top_n: Math.min(topN, documents.length),
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 400);
      try {
        const parsed = JSON.parse(text) as RerankResponse;
        message = parsed.error?.message ?? message;
      } catch {
        /* keep raw */
      }
      throw new Error(`Rerank 请求失败（HTTP ${response.status}）：${message}`);
    }
    const parsed = JSON.parse(text) as RerankResponse;
    return (parsed.results ?? [])
      .map((item) => ({
        index: Number(item.index ?? -1),
        score: Number(item.relevance_score ?? item.score ?? 0),
      }))
      .filter((item) => item.index >= 0 && item.index < documents.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  } finally {
    clearTimeout(timer);
  }
}
