import type { LlmSettings } from "../types.js";
import { readSettings } from "../store.js";
import { safeJsonParse } from "../util/text.js";

export class LlmError extends Error {
  status?: number;
  retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.retryable = retryable;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface CompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError("请求已取消", undefined, false));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new LlmError("请求已取消", undefined, false));
      },
      { once: true },
    );
  });
}

export class LlmClient {
  private settings: LlmSettings;
  private jsonModeSupported = true;

  constructor(settings?: LlmSettings) {
    this.settings = settings ?? readSettings().llm;
  }

  get model(): string {
    return this.settings.model;
  }

  get isMock(): boolean {
    return this.settings.mock;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    if (this.settings.mock) {
      return "MOCK_OK";
    }
    if (!this.settings.baseUrl) throw new LlmError("未配置 LLM Base URL，请先到「设置」中配置模型服务。");
    if (!this.settings.apiKey) throw new LlmError("未配置 API Key，请先到「设置」中配置模型服务。");

    const json = options.json ?? false;
    const body: Record<string, unknown> = {
      model: this.settings.model,
      messages,
      temperature: options.temperature ?? this.settings.temperature,
      max_tokens: options.maxTokens ?? this.settings.maxTokens,
      stream: false,
    };
    if (json && this.settings.jsonMode && this.jsonModeSupported) {
      body.response_format = { type: "json_object" };
    }

    let lastError: LlmError | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.settings.timeoutMs);
      const onAbort = (): void => controller.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await fetch(endpoint(this.settings.baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.settings.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          let message = text.slice(0, 500);
          try {
            const parsed = JSON.parse(text) as CompletionResponse;
            message = parsed.error?.message ?? message;
          } catch {
            /* keep raw */
          }
          if (response.status === 400 && json && this.jsonModeSupported) {
            // Some OpenAI-compatible gateways do not implement response_format.
            this.jsonModeSupported = false;
            delete body.response_format;
            continue;
          }
          const retryable = response.status === 429 || response.status >= 500;
          lastError = new LlmError(`LLM 请求失败（HTTP ${response.status}）：${message}`, response.status, retryable);
          if (!retryable) throw lastError;
          await sleep(800 * (attempt + 1), options.signal);
          continue;
        }

        const parsed = safeJsonParse<CompletionResponse>(text);
        if (!parsed) throw new LlmError(`LLM 返回了无法解析的响应：${text.slice(0, 200)}`, response.status, false);
        const content = parsed.choices?.[0]?.message?.content ?? "";
        if (!content.trim()) {
          const finish = parsed.choices?.[0]?.finish_reason;
          throw new LlmError(`LLM 返回空内容${finish ? `（finish_reason=${finish}）` : ""}`, response.status, true);
        }
        return content;
      } catch (err) {
        if (err instanceof LlmError) {
          if (!err.retryable) throw err;
          lastError = err;
        } else if ((err as Error).name === "AbortError") {
          lastError = new LlmError("LLM 请求超时，请检查网络或调大超时时间。", undefined, true);
        } else {
          lastError = new LlmError(`LLM 网络错误：${(err as Error).message}`, undefined, true);
        }
        if (attempt < 2) await sleep(800 * (attempt + 1), options.signal);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError ?? new LlmError("LLM 调用失败");
  }

  async chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const content = await this.chat(messages, { ...options, json: true });
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = safeJsonParse<T>(cleaned);
    if (parsed === undefined) {
      throw new LlmError(`LLM 未返回合法 JSON：${cleaned.slice(0, 300)}`);
    }
    return parsed;
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    const content = await this.chat(
      [
        { role: "system", content: "你是一个连通性测试助手。" },
        { role: "user", content: "请只回复两个字：正常" },
      ],
      { maxTokens: 32, temperature: 0, timeoutMs: 30000 },
    );
    return { ok: true, latencyMs: Date.now() - start, message: content.slice(0, 80) };
  }
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new LlmError("任务已取消", undefined, false);
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
