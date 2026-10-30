/**
 * LLM 设置 API。
 *
 * 读取/保存模型配置、连接测试，并处理开发环境 .env 接管逻辑。
 */

import { Router } from "express";
import type { LlmSettings } from "../types.js";
import {
  isLlmConfigured,
  publicSettings,
  readSettings,
  readStoredSettings,
  writeSettings,
} from "../store.js";
import { LlmClient } from "../llm/client.js";
import { getEnvConfigInfo, isEnvActive } from "../config/env.js";

export const settingsRouter = Router();

function response() {
  return {
    settings: publicSettings(),
    configured: isLlmConfigured(),
    meta: getEnvConfigInfo(),
  };
}

function sanitize(input: Partial<LlmSettings>, base: LlmSettings): LlmSettings {
  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    baseUrl: String(input.baseUrl ?? base.baseUrl).trim().slice(0, 500),
    apiKey: String(input.apiKey ?? base.apiKey).trim().slice(0, 500),
    model: String(input.model ?? base.model).trim().slice(0, 200),
    temperature: num(input.temperature, base.temperature, 0, 2),
    maxTokens: Math.round(num(input.maxTokens, base.maxTokens, 256, 32000)),
    concurrency: Math.round(num(input.concurrency, base.concurrency, 1, 8)),
    timeoutMs: Math.round(num(input.timeoutMs, base.timeoutMs, 10000, 600000)),
    jsonMode: input.jsonMode === undefined ? base.jsonMode : Boolean(input.jsonMode),
    mock: input.mock === undefined ? base.mock : Boolean(input.mock),
  };
}

settingsRouter.get("/settings", (_req, res) => {
  res.json(response());
});

/**
 * 保存 LLM 设置。
 *
 * 校验 URL/模型，处理 API Key 保留和开发环境 .env 接管。
 */
settingsRouter.put("/settings", (req, res) => {
  if (isEnvActive()) {
    res.status(409).json({
      error:
        "当前为开发环境，LLM 配置由项目根目录 .env 接管。请修改 .env 中的 LLM_* 变量并重启开发服务；如需改用页面配置，请清空 .env 中的 LLM_* 变量。",
      meta: getEnvConfigInfo(),
    });
    return;
  }
  const current = readStoredSettings();
  const incoming = (req.body?.llm ?? {}) as Partial<LlmSettings>;
  const clearKey = Boolean(req.body?.clearApiKey);
  const next = sanitize(incoming, current.llm);
  if (clearKey) next.apiKey = "";
  else if (incoming.apiKey === "" || incoming.apiKey === undefined) next.apiKey = current.llm.apiKey;
  if (!next.baseUrl || !next.model) {
    res.status(400).json({ error: "Base URL 与模型名称不能为空" });
    return;
  }
  if (!/^https?:\/\//i.test(next.baseUrl)) {
    res.status(400).json({ error: "Base URL 必须以 http:// 或 https:// 开头" });
    return;
  }
  writeSettings({ llm: next });
  res.json(response());
});

settingsRouter.post("/settings/test", async (req, res) => {
  const envActive = isEnvActive();
  const incoming = (req.body?.llm ?? {}) as Partial<LlmSettings>;
  let merged: LlmSettings;
  if (envActive) {
    // In development the effective config comes from .env, ignore page form values.
    merged = readSettings().llm;
  } else {
    const current = readStoredSettings().llm;
    merged = sanitize(incoming, current);
    if (!incoming.apiKey) merged.apiKey = current.apiKey;
  }
  if (merged.mock) {
    res.json({ ok: true, latencyMs: 0, message: "演示模式（Mock）已启用，不会访问真实模型服务。" });
    return;
  }
  if (!merged.apiKey) {
    res.status(400).json({
      error: envActive
        ? "开发环境使用 .env：请在项目根目录 .env 中填写 LLM_API_KEY，然后重启开发服务。"
        : "请先填写 API Key",
    });
    return;
  }
  try {
    const client = new LlmClient(merged);
    const result = await client.testConnection();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
