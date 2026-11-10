/**
 * SQLite schema。
 *
 * 顶层实体各占一行，payload 保存完整 JSON 对象；不把需求/设计/关系拆成
 * 关系表，保持 StoreData 和现有 API 兼容。
 */

import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_project
  ON documents(project_id, kind, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project
  ON snapshots(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_campaigns_project
  ON campaigns(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Create tables/indexes and record the schema version. */
export function ensureSchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get("schema_version") as
    | { value?: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta(key, value) VALUES(?, ?)").run("schema_version", String(SCHEMA_VERSION));
  }
}
