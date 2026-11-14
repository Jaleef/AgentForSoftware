/**
 * OpenAI 兼容 LLM 客户端适配层。
 *
 * 底层使用官方 openai SDK（Chat Completions）；本层保留项目原有的
 * LlmClient API，并统一处理 DeepSeek 兼容网关、JSON 模式降级、usage、
 * 预算和取消。业务 Agent 不直接依赖 SDK。
 */

import OpenAI from "openai";
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

function normalizeBaseUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/chat/completions")
    ? base.slice(0, -"/chat/completions".length)
    : base;
}

function isAbort(error: unknown): boolean {
  return (error as Error)?.name === "AbortError" || (error as Error)?.name === "APIUserAbortError";
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * 官方 OpenAI SDK 适配层。
 *
 * - 调用 `client.chat.completions.create`；
 * - baseURL 兼容 DeepSeek/OpenAI 兼容网关；
 * - 保留 Json mode 不支持时的 400 降级；
 * - 记录 SDK 返回的 usage 和逻辑调用次数；
 * - AbortSignal 直接传给 SDK 请求。
 */
export class LlmClient {
  private settings: LlmSettings;
  private client: OpenAI | null = null;
  private jsonModeSupported = true;
  private callCount = 0;
  private maxCalls = Number.POSITIVE_INFINITY;
  private promptTokens = 0;
  private completionTokens = 0;

  constructor(settings?: LlmSettings) {
    this.settings = settings ?? readSettings().llm;
  }

  get calls(): number {
    return this.callCount;
  }

  get usage(): { promptTokens: number; completionTokens: number; llmCalls: number } {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      llmCalls: this.callCount,
    };
  }

  resetUsage(): void {
    this.callCount = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
  }

  /** Hard cap for agent budgets; legacy callers keep the default unlimited value. */
  setMaxCalls(maxCalls: number): void {
    this.maxCalls = Math.max(0, Math.floor(maxCalls));
  }

  get model(): string {
    return this.settings.model;
  }

  get isMock(): boolean {
    return this.settings.mock;
  }

  /**
   * 延迟创建 OpenAI SDK 客户端。
   *
   * 调用 `new OpenAI({ baseURL, timeout, maxRetries })`；不在模块加载时创建，
   * 这样未配置模型的纯启发式流程不会初始化网络客户端。
   */
  private sdk(): OpenAI {
    if (!this.client) {
      if (!this.settings.baseUrl) {
        throw new LlmError("未配置 LLM Base URL，请先到「设置」中配置模型服务。");
      }
      if (!this.settings.apiKey) {
        throw new LlmError("未配置 API Key，请先到「设置」中配置模型服务。");
      }
      this.client = new OpenAI({
        apiKey: this.settings.apiKey,
        baseURL: normalizeBaseUrl(this.settings.baseUrl),
        timeout: this.settings.timeoutMs,
        // Keep retries inside the SDK; business-level batch fallback remains.
        maxRetries: 3,
      });
    }
    return this.client;
  }

  /**
   * 调用 OpenAI SDK 的 Chat Completions。
   *
   * 负责 response_format 降级、usage 累计、AbortSignal、预算和错误转换；
   * 业务 Agent 只看到字符串内容和 LlmError。
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    if (this.settings.mock) return "MOCK_OK";
    if (this.callCount >= this.maxCalls) {
      throw new LlmError("已达到本次任务的 LLM 调用预算上限，请缩小范围或提高预算。", undefined, false);
    }

    const json = options.json ?? false;
    const body = {
      model: this.settings.model,
      messages,
      temperature: options.temperature ?? this.settings.temperature,
      max_tokens: options.maxTokens ?? this.settings.maxTokens,
      stream: false as const,
      ...(json && this.settings.jsonMode && this.jsonModeSupported
        ? { response_format: { type: "json_object" as const } }
        : {}),
    };

    this.callCount++;
    try {
      const completion = await this.sdk().chat.completions.create(body, {
        signal: options.signal,
        timeout: options.timeoutMs ?? this.settings.timeoutMs,
      });
      this.promptTokens += completion.usage?.prompt_tokens ?? 0;
      this.completionTokens += completion.usage?.completion_tokens ?? 0;
      const content = completion.choices[0]?.message?.content ?? "";
      if (!content.trim()) {
        const finish = completion.choices[0]?.finish_reason;
        throw new LlmError(
          `LLM 返回空内容${finish ? `（finish_reason=${finish}）` : ""}`,
          undefined,
          true,
        );
      }
      return content;
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (isAbort(error)) {
        if (options.signal?.aborted) throw new LlmError("任务已取消", undefined, false);
        throw new LlmError("LLM 请求超时，请检查网络或调大超时时间。", undefined, true);
      }

      const status = statusOf(error);
      const message = (error as Error).message || "LLM 请求失败";
      // Some OpenAI-compatible gateways do not implement response_format.
      if (status === 400 && json && this.jsonModeSupported) {
        this.jsonModeSupported = false;
        this.callCount--;
        return this.chat(messages, { ...options, json: true });
      }
      throw new LlmError(
        `LLM 请求失败${status ? `（HTTP ${status}）` : ""}：${message}`,
        status,
        status === 429 || (status !== undefined && status >= 500) || status === undefined,
      );
    }
  }

  /**
   * 复用 chat()，清理 Markdown 代码围栏后解析 JSON。
   *
   * SDK/网关返回的 content 仍是字符串，因此 JSON 解析和错误信息由本层负责。
   */
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

  /**
   * 轻量连通性测试：走同一条 SDK chat 路径，避免设置页与业务请求行为分叉。
   */
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

/**
 * 按并发上限执行异步任务。
 *
 * 保留本项目自己的小工具而不是引入 p-limit：这里需要透传 AbortSignal、
 * 保持结果顺序，并且与 LlmError 的取消语义绑定。
 */
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
