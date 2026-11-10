/**
 * JSON 文件持久化与设置存储。
 *
 * 维护项目、文档、快照、评价任务和 LLM 设置，串行化写入并做密钥脱敏。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppSettings,
  Campaign,
  CodeSnapshot,
  LlmSettings,
  Project,
  StoredDocument,
  StoreData,
} from "./types.js";
import { nowIso } from "./util/id.js";
import { applyEnvOverrides } from "./config/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
export const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(packageRoot, "..", "data");
export const uploadsDir = join(dataDir, "uploads");
const storeFile = join(dataDir, "store.json");
const settingsFile = join(dataDir, "settings.json");

const emptyStore: StoreData = {
  version: 1,
  projects: [],
  documents: [],
  snapshots: [],
  campaigns: [],
};

let cache: StoreData | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

/** 保证 dataDir 和 uploadDir 两个文件夹都存在 */
function ensureDirs(): void {
  for (const dir of [dataDir, uploadsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** 同步加载 data/store.json 文件内容，
 * 返回一个 StoreData 类型的对象 */
function loadSync(): StoreData {
  ensureDirs();
  if (!existsSync(storeFile)) return structuredClone(emptyStore);
  try {
    // Partial<StoreData> 将读出的 StoreData 允许缺少字段，便于向前兼容 
    const parsed = JSON.parse(readFileSync(storeFile, "utf8")) as Partial<StoreData>;
    return {
      version: parsed.version ?? 1,
      projects: parsed.projects ?? [],
      documents: parsed.documents ?? [],
      snapshots: parsed.snapshots ?? [],
      campaigns: parsed.campaigns ?? [],
    };
  } catch (err) {
    const backup = `${storeFile}.corrupt-${Date.now()}`;
    try {
      copyFileSync(storeFile, backup);
    } catch {
      /* ignore */
    }
    console.error(`[store] 数据文件损坏，已备份到 ${backup}`, err);
    return structuredClone(emptyStore);
  }
}

/**
 * 读取内存中的全局数据仓库。
 *
 * 首次访问时从 data/store.json 加载，并在损坏时备份。
 */
export async function getStore(): Promise<StoreData> {
  if (!cache) cache = loadSync();
  return cache;
}

/** 将 StoreData 对象写入 data/store.json (非追加，替换) */
function persist(data: StoreData): void {
  ensureDirs();
  const tmp = `${storeFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, storeFile);
}

/**
 * 串行修改并持久化全局数据仓库。
 *
 * 所有写操作进入队列，避免并发覆盖 JSON 文件。
 */
export function mutateStore<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const data = await getStore();
    const result = await fn(data);
    persist(data);
    return result;
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

/** 查找项目信息，
 * 返回一个 Project 对象 */
export async function findProject(projectId: string): Promise<Project | undefined> {
  const data = await getStore();
  return data.projects.find((p) => p.id === projectId);
}

/** 根据 projectID, 查找项目里的所有的文件；
 * 返回一个
 */
export async function getProjectDocuments(projectId: string): Promise<StoredDocument[]> {
  const data = await getStore();
  return data.documents.filter((d) => d.projectId === projectId);
}

export async function getDocument(projectId: string, kind: "srs" | "sdd"): Promise<StoredDocument | undefined> {
  const docs = await getProjectDocuments(projectId);
  return docs.filter((d) => d.kind === kind).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

export async function getSnapshot(projectId: string): Promise<CodeSnapshot | undefined> {
  const data = await getStore();
  return data.snapshots
    .filter((s) => s.projectId === projectId && s.status === "ready")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function getCampaigns(projectId: string): Promise<Campaign[]> {
  const data = await getStore();
  return data.campaigns
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCampaign(projectId: string, campaignId: string): Promise<Campaign | undefined> {
  const data = await getStore();
  return data.campaigns.find((c) => c.projectId === projectId && c.id === campaignId);
}

export function projectDir(projectId: string): string {
  return join(uploadsDir, projectId);
}

export function ensureProjectDir(projectId: string): string {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function touchProject(project: Project): void {
  project.updatedAt = nowIso();
}

const defaultLlm: LlmSettings = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  temperature: 0.1,
  maxTokens: 4096,
  concurrency: 3,
  timeoutMs: 120000,
  jsonMode: true,
  mock: false,
};

const defaultSettings: AppSettings = { llm: defaultLlm };

/** Settings as stored on disk, without development .env overrides. */
export function readStoredSettings(): AppSettings {
  ensureDirs();
  if (!existsSync(settingsFile)) return structuredClone(defaultSettings);
  try {
    const parsed = JSON.parse(readFileSync(settingsFile, "utf8")) as Partial<AppSettings>;
    return { llm: { ...defaultLlm, ...(parsed.llm ?? {}) } };
  } catch {
    return structuredClone(defaultSettings);
  }
}

/** Effective settings: stored values, overlaid by development .env when active. */
export function readSettings(): AppSettings {
  const stored = readStoredSettings();
  return { llm: applyEnvOverrides(stored.llm) };
}

export function writeSettings(settings: AppSettings): void {
  ensureDirs();
  const tmp = `${settingsFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  renameSync(tmp, settingsFile);
}

export function publicSettings(): Omit<LlmSettings, "apiKey"> & { hasApiKey: boolean; apiKeyHint: string } {
  const { apiKey, ...rest } = readSettings().llm;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyHint: apiKey ? `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}` : "",
  };
}

export function isLlmConfigured(): boolean {
  const llm = readSettings().llm;
  return Boolean(llm.baseUrl && llm.model && (llm.apiKey || llm.mock));
}
