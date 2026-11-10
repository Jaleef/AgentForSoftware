/**
 * JSON 文件到 SQLite 的一次性迁移。
 *
 * 迁移在单个事务中完成；成功后把旧文件改名为 .migrated-* 备份。
 */

import { copyFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Campaign, CodeSnapshot, Project, StoredDocument, StoreData } from "../types.js";
import { withTransaction } from "./db.js";

export interface MigrationResult {
  migrated: boolean;
  reason: string;
  backups: string[];
  warnings: string[];
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hasMarker(db: DatabaseSync, key: string): boolean {
  return Boolean(db.prepare("SELECT value FROM meta WHERE key = ?").get(key));
}

function setMarker(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function backup(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const target = `${path}.migrated-${timestamp()}`;
  try {
    renameSync(path, target);
    return target;
  } catch {
    try {
      copyFileSync(path, target);
      return target;
    } catch {
      return undefined;
    }
  }
}

function parseStore(path: string): Partial<StoreData> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoreData>;
  for (const key of ["projects", "documents", "snapshots", "campaigns"] as const) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new Error(`${path} 的 ${key} 不是数组`);
    }
  }
  return parsed;
}

function insertProject(db: DatabaseSync, project: Project): void {
  db.prepare(
    "INSERT INTO projects(id, created_at, updated_at, payload) VALUES(?, ?, ?, ?)",
  ).run(project.id, project.createdAt, project.updatedAt, JSON.stringify(project));
}

function insertDocument(db: DatabaseSync, document: StoredDocument): void {
  db.prepare(
    `INSERT INTO documents(id, project_id, kind, uploaded_at, updated_at, payload)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).run(
    document.id,
    document.projectId,
    document.kind,
    document.uploadedAt,
    document.updatedAt,
    JSON.stringify(document),
  );
}

function insertSnapshot(db: DatabaseSync, snapshot: CodeSnapshot): void {
  db.prepare(
    "INSERT INTO snapshots(id, project_id, created_at, payload) VALUES(?, ?, ?, ?)",
  ).run(snapshot.id, snapshot.projectId, snapshot.createdAt, JSON.stringify(snapshot));
}

function insertCampaign(db: DatabaseSync, campaign: Campaign): void {
  db.prepare(
    `INSERT INTO campaigns(id, project_id, status, created_at, updated_at, payload)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).run(
    campaign.id,
    campaign.projectId,
    campaign.status,
    campaign.createdAt,
    campaign.finishedAt ?? campaign.startedAt ?? campaign.createdAt,
    JSON.stringify(campaign),
  );
}

/**
 * Import data/store.json and data/settings.json once.
 *
 * The migration marker is written in the same transaction as the data so a
 * crash cannot mark an incomplete import as done.
 */
export function migrateLegacyJson(db: DatabaseSync, dataDir: string): MigrationResult {
  const result: MigrationResult = {
    migrated: false,
    reason: "",
    backups: [],
    warnings: [],
  };
  if (hasMarker(db, "json_migration_v1")) {
    result.reason = "already-migrated";
    return result;
  }

  const storePath = join(dataDir, "store.json");
  const settingsPath = join(dataDir, "settings.json");
  const projectCount = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count?: number }).count ?? 0,
  );
  if (projectCount > 0) {
    setMarker(db, "json_migration_v1", "existing-db");
    result.reason = "database-already-has-data";
    return result;
  }

  const hasStore = existsSync(storePath);
  const hasSettings = existsSync(settingsPath);
  if (!hasStore && !hasSettings) {
    setMarker(db, "json_migration_v1", "empty");
    result.reason = "no-legacy-files";
    return result;
  }

  const store = hasStore ? parseStore(storePath) : {};
  let settings: Record<string, unknown> | undefined;
  if (hasSettings) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch (error) {
      result.warnings.push(`settings.json 无法解析，已忽略：${(error as Error).message}`);
    }
  }

  const projects = (store.projects ?? []) as Project[];
  const documents = (store.documents ?? []) as StoredDocument[];
  const snapshots = (store.snapshots ?? []) as CodeSnapshot[];
  const campaigns = (store.campaigns ?? []) as Campaign[];

  withTransaction(db, () => {
    for (const project of projects) insertProject(db, project);
    for (const document of documents) insertDocument(db, document);
    for (const snapshot of snapshots) insertSnapshot(db, snapshot);
    for (const campaign of campaigns) insertCampaign(db, campaign);
    if (settings) {
      db.prepare(
        "INSERT OR REPLACE INTO settings(id, payload, updated_at) VALUES(1, ?, ?)",
      ).run(JSON.stringify(settings), new Date().toISOString());
    }
    setMarker(db, "store_version", String(store.version ?? 1));
    setMarker(db, "json_migration_v1", "done");
  });

  result.migrated = true;
  result.reason = "migrated";
  result.backups = [backup(storePath), backup(settingsPath)].filter(
    (item): item is string => Boolean(item),
  );
  if (result.backups.length < (hasStore ? 1 : 0) + (hasSettings ? 1 : 0)) {
    result.warnings.push("旧 JSON 文件备份失败，但迁移已完成；请手动保留原文件。");
  }
  return result;
}
