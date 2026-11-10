/**
 * 开发环境 .env 读取与 LLM 配置覆盖。
 *
 * 只影响开发进程；生产构建仍以设置页/运行环境配置为准。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmSettings } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));
/** repo root: server/src/config -> server/src -> server -> repo */
const repoRoot = resolve(here, "..", "..", "..");
export const envFilePath = resolve(repoRoot, ".env");

export interface EnvConfigInfo {
  environment: "development" | "production";
  configSource: "env" | "settings";
  envFile: string;
  envLoaded: boolean;
  envActive: boolean;
  /** True when .env changed after this process loaded it; restart is required. */
  envFileChanged: boolean;
  /** Variables already present in the process environment; they win over .env. */
  shadowedKeys: string[];
  values: {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    apiKeyHint: string;
    mock: boolean;
  };
}

function detectDevelopment(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.NODE_ENV === "development") return true;
  const entry = process.argv[1] ?? "";
  // tsx watch src/index.ts / tsx src/tools/... should behave like development,
  // while node server/dist/index.js must behave like a deployment.
  return /[\\/]src[\\/]/.test(entry) && !/[\\/]dist[\\/]/.test(entry);
}

const isDevelopment = detectDevelopment();

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

let envLoaded = false;
let envLoadedMtimeMs = 0;
const shadowedKeys: string[] = [];
if (isDevelopment && existsSync(envFilePath)) {
  try {
    envLoadedMtimeMs = statSync(envFilePath).mtimeMs;
    const parsed = parseEnvFile(readFileSync(envFilePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      // Real process environment has higher priority than the file. Record it
      // because this is a common cause of "I changed .env but it still uses
      // the old key" confusion.
      if (process.env[key] === undefined) process.env[key] = value;
      else shadowedKeys.push(key);
    }
    envLoaded = true;
    if (shadowedKeys.length) {
      console.warn(
        `[env] 以下进程环境变量优先于 .env，可能来自启动终端/VS Code：${[
          ...new Set(shadowedKeys),
        ].join(", ")}`,
      );
    }
  } catch (err) {
    console.warn(`[env] 无法读取 ${envFilePath}: ${(err as Error).message}`);
  }
}

/** Detect edits that happened after process start; tsx watch does not reload .env. */
function envFileChanged(): boolean {
  if (!isDevelopment || !envLoaded) return false;
  try {
    return statSync(envFilePath).mtimeMs !== envLoadedMtimeMs;
  } catch {
    return false;
  }
}

interface EnvValue {
  present: boolean;
  value: string;
}

function envValue(...names: string[]): EnvValue {
  for (const name of names) {
    if (process.env[name] !== undefined) return { present: true, value: process.env[name] ?? "" };
  }
  return { present: false, value: "" };
}

const envBaseUrl = envValue("LLM_BASE_URL", "OPENAI_BASE_URL", "DEEPSEEK_BASE_URL");
const envModel = envValue("LLM_MODEL", "OPENAI_MODEL", "DEEPSEEK_MODEL");
const envApiKey = envValue("LLM_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY");
const envTemperature = envValue("LLM_TEMPERATURE");
const envMaxTokens = envValue("LLM_MAX_TOKENS");
const envConcurrency = envValue("LLM_CONCURRENCY");
const envTimeout = envValue("LLM_TIMEOUT_MS");
const envJsonMode = envValue("LLM_JSON_MODE");
const envMock = envValue("LLM_MOCK");

/** Only development mode is allowed to override the settings page with .env values. */
export const envActive =
  isDevelopment &&
  [
    envBaseUrl,
    envModel,
    envApiKey,
    envTemperature,
    envMaxTokens,
    envConcurrency,
    envTimeout,
    envJsonMode,
    envMock,
  ].some((value) => value.present);

function boolValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 把开发环境 `.env` 中的 LLM 配置合并到设置对象。
 *
 * 只覆盖显式配置的字段；生产构建不会走这里。
 */
export function applyEnvOverrides(base: LlmSettings): LlmSettings {
  if (!envActive) return base;
  const next: LlmSettings = { ...base };
  if (envBaseUrl.present) next.baseUrl = envBaseUrl.value.trim();
  if (envModel.present) next.model = envModel.value.trim();
  if (envApiKey.present) next.apiKey = envApiKey.value.trim();
  const temperature = numberValue(envTemperature.value);
  if (envTemperature.present && temperature !== undefined) next.temperature = temperature;
  const maxTokens = numberValue(envMaxTokens.value);
  if (envMaxTokens.present && maxTokens !== undefined) next.maxTokens = maxTokens;
  const concurrency = numberValue(envConcurrency.value);
  if (envConcurrency.present && concurrency !== undefined) next.concurrency = concurrency;
  const timeout = numberValue(envTimeout.value);
  if (envTimeout.present && timeout !== undefined) next.timeoutMs = timeout;
  if (envJsonMode.present) {
    const parsed = boolValue(envJsonMode.value);
    if (parsed !== undefined) next.jsonMode = parsed;
  }
  if (envMock.present) {
    const parsed = boolValue(envMock.value);
    if (parsed !== undefined) next.mock = parsed;
  }
  return next;
}

export function isEnvActive(): boolean {
  return envActive;
}

export function getEnvConfigInfo(): EnvConfigInfo {
  const apiKey = envActive ? envApiKey.value : "";
  return {
    environment: isDevelopment ? "development" : "production",
    configSource: envActive ? "env" : "settings",
    envFile: envFilePath,
    envLoaded,
    envActive,
    envFileChanged: envFileChanged(),
    shadowedKeys: [...new Set(shadowedKeys)],
    values: {
      baseUrl: envActive ? envBaseUrl.value : "",
      model: envActive ? envModel.value : "",
      hasApiKey: Boolean(apiKey),
      apiKeyHint: apiKey ? `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}` : "",
      mock: envActive ? (boolValue(envMock.value) ?? false) : false,
    },
  };
}
