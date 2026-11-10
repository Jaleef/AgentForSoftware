/**
 * SQLite 持久化与设置存储。
 *
 * 对外仍暴露 StoreData 和原有 getStore()/mutateStore() 接口；内部使用
 * node:sqlite，每个顶层实体一行、payload 保存完整 JSON。
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
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
import { openDatabase, withTransaction } from "./storage/db.js";
import { ensureSchema } from "./storage/schema.js";
import { migrateLegacyJson } from "./storage/migrate.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
export const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(packageRoot, "..", "data");
export const uploadsDir = join(dataDir, "uploads");
export const databaseFile = join(dataDir, "app.db");

const emptyStore: StoreData = {
  version: 1,
  projects: [],
  documents: [],
  snapshots: [],
  campaigns: [],
};

interface PersistedRows {
  projects: Map<string, string>;
  documents: Map<string, string>;
  snapshots: Map<string, string>;
  campaigns: Map<string, string>;
}

let db: DatabaseSync | null = null;
let cache: StoreData | null = null;
let persisted: PersistedRows = emptyRows();
let writeQueue: Promise<unknown> = Promise.resolve();

function emptyRows(): PersistedRows {
  return {
    projects: new Map(),
    documents: new Map(),
    snapshots: new Map(),
    campaigns: new Map(),
  };
}

/** 保证 dataDir 和 uploadDir 两个文件夹都存在 */
function ensureDirs(): void {
  for (const dir of [dataDir, uploadsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** Open the database lazily and perform the one-time JSON migration. */
function getDb(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  const opened = openDatabase(databaseFile);
  ensureSchema(opened);
  try {
    const migration = migrateLegacyJson(opened, dataDir);
    if (migration.migrated) {
      console.log(`[store] 已迁移 JSON → SQLite：${databaseFile}`);
    }
    for (const warning of migration.warnings) console.warn(`[store] ${warning}`);
    for (const backup of migration.backups) console.log(`[store] 旧数据备份：${backup}`);
  } catch (error) {
    opened.close();
    throw new Error(`SQLite 迁移失败，原 JSON 文件已保留：${(error as Error).message}`);
  }
  db = opened;
  return db;
}

function readPayloads<T>(database: DatabaseSync, table: string): T[] {
  return (database.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all() as Array<{ payload: string }>).map(
    (row) => JSON.parse(row.payload) as T,
  );
}

function loadFromDb(): StoreData {
  const database = getDb();
  const versionRow = database.prepare("SELECT value FROM meta WHERE key = ?").get("store_version") as
    | { value?: string }
    | undefined;
  return {
    version: Number(versionRow?.value ?? 1),
    projects: readPayloads<Project>(database, "projects"),
    documents: readPayloads<StoredDocument>(database, "documents"),
    snapshots: readPayloads<CodeSnapshot>(database, "snapshots"),
    campaigns: readPayloads<Campaign>(database, "campaigns"),
  };
}

function rowsFrom(data: StoreData): PersistedRows {
  return {
    projects: new Map(data.projects.map((item) => [item.id, JSON.stringify(item)])),
    documents: new Map(data.documents.map((item) => [item.id, JSON.stringify(item)])),
    snapshots: new Map(data.snapshots.map((item) => [item.id, JSON.stringify(item)])),
    campaigns: new Map(data.campaigns.map((item) => [item.id, JSON.stringify(item)])),
  };
}

function upsert(
  database: DatabaseSync,
  table: string,
  columns: string[],
  values: unknown[],
): void {
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  database
    .prepare(
      `INSERT INTO ${table}(${columns.join(", ")}) VALUES(${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates}`,
    )
    .run(...(values as never[]));
}

function deleteMissing(database: DatabaseSync, table: string, current: Map<string, string>, previous: Map<string, string>): void {
  const statement = database.prepare(`DELETE FROM ${table} WHERE id = ?`);
  for (const id of previous.keys()) {
    if (!current.has(id)) statement.run(id);
  }
}

function persist(data: StoreData): void {
  const database = getDb();
  const next = rowsFrom(data);
  withTransaction(database, () => {
    for (const project of data.projects) {
      if (persisted.projects.get(project.id) === next.projects.get(project.id)) continue;
      upsert(
        database,
        "projects",
        ["id", "created_at", "updated_at", "payload"],
        [project.id, project.createdAt, project.updatedAt, next.projects.get(project.id)],
      );
    }
    for (const document of data.documents) {
      if (persisted.documents.get(document.id) === next.documents.get(document.id)) continue;
      upsert(
        database,
        "documents",
        ["id", "project_id", "kind", "uploaded_at", "updated_at", "payload"],
        [
          document.id,
          document.projectId,
          document.kind,
          document.uploadedAt,
          document.updatedAt,
          next.documents.get(document.id),
        ],
      );
    }
    for (const snapshot of data.snapshots) {
      if (persisted.snapshots.get(snapshot.id) === next.snapshots.get(snapshot.id)) continue;
      upsert(
        database,
        "snapshots",
        ["id", "project_id", "created_at", "payload"],
        [snapshot.id, snapshot.projectId, snapshot.createdAt, next.snapshots.get(snapshot.id)],
      );
    }
    for (const campaign of data.campaigns) {
      if (persisted.campaigns.get(campaign.id) === next.campaigns.get(campaign.id)) continue;
      upsert(
        database,
        "campaigns",
        ["id", "project_id", "status", "created_at", "updated_at", "payload"],
        [
          campaign.id,
          campaign.projectId,
          campaign.status,
          campaign.createdAt,
          campaign.finishedAt ?? campaign.startedAt ?? campaign.createdAt,
          next.campaigns.get(campaign.id),
        ],
      );
    }

    deleteMissing(database, "documents", next.documents, persisted.documents);
    deleteMissing(database, "snapshots", next.snapshots, persisted.snapshots);
    deleteMissing(database, "campaigns", next.campaigns, persisted.campaigns);
    deleteMissing(database, "projects", next.projects, persisted.projects);
  });
  persisted = next;
}

/**
 * 读取内存中的全局数据仓库。
 *
 * 首次访问时从 SQLite 加载；迁移只执行一次。
 */
export async function getStore(): Promise<StoreData> {
  if (!cache) {
    if (!db) getDb();
    cache = loadFromDb();
    persisted = rowsFrom(cache);
  }
  return cache;
}

/**
 * 串行修改并持久化全局数据仓库。
 *
 * 先执行修改，再按实体 diff 写入 SQLite；失败时清空内存缓存，确保下次
 * 从数据库重新加载而不是保留半写入状态。
 */
export function mutateStore<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const data = await getStore();
    try {
      const result = await fn(data);
      persist(data);
      return result;
    } catch (error) {
      cache = null;
      throw error;
    }
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

/** 查找项目信息 */
export async function findProject(projectId: string): Promise<Project | undefined> {
  const data = await getStore();
  return data.projects.find((p) => p.id === projectId);
}

/** 根据 projectID，查找项目里的所有文档 */
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
  const database = getDb();
  const row = database.prepare("SELECT payload FROM settings WHERE id = 1").get() as
    | { payload?: string }
    | undefined;
  if (!row?.payload) return structuredClone(defaultSettings);
  try {
    const parsed = JSON.parse(row.payload) as Partial<AppSettings>;
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
  const database = getDb();
  withTransaction(database, () => {
    database
      .prepare(
        "INSERT INTO settings(id, payload, updated_at) VALUES(1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify(settings), new Date().toISOString());
  });
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

/** Close the database; used by tests and graceful shutdown. */
export function closeStore(): void {
  db?.close();
  db = null;
  cache = null;
  persisted = emptyRows();
}
