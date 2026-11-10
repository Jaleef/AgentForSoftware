/**
 * SQLite 存储 smoke 测试。
 *
 * 在临时 DATA_DIR 中创建旧 JSON、执行迁移、读写项目/设置，并验证重开
 * 数据库后数据仍在。
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "consistency-store-"));
  process.env.DATA_DIR = dir;
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, "store.json"),
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: "prj_smoke",
          name: "smoke",
          description: "store smoke",
          createdAt: now,
          updatedAt: now,
        },
      ],
      documents: [],
      snapshots: [],
      campaigns: [],
    }),
  );
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      llm: {
        baseUrl: "http://127.0.0.1:9/v1",
        apiKey: "smoke-key",
        model: "smoke-model",
        temperature: 0,
        maxTokens: 512,
        concurrency: 1,
        timeoutMs: 10000,
        jsonMode: true,
        mock: false,
      },
    }),
  );

  const store = await import("../store.js");
  try {
    const data = await store.getStore();
    if (data.projects.length !== 1 || data.projects[0].id !== "prj_smoke") {
      throw new Error("JSON 迁移后的项目数据不正确");
    }
    if (!existsSync(join(dir, "app.db"))) throw new Error("app.db 未创建");
    if (!readdirSync(dir).some((name) => name.startsWith("store.json.migrated-"))) {
      throw new Error("store.json 未备份");
    }

    if (store.readStoredSettings().llm.model !== "smoke-model") {
      throw new Error("settings.json 迁移失败");
    }
    const current = store.readStoredSettings();
    store.writeSettings({ llm: { ...current.llm, model: "sqlite-model" } });
    if (store.readStoredSettings().llm.model !== "sqlite-model") {
      throw new Error("SQLite 设置写入失败");
    }

    await store.mutateStore((draft) => {
      draft.projects[0].name = "smoke-updated";
    });
    if ((await store.getStore()).projects[0].name !== "smoke-updated") {
      throw new Error("项目更新失败");
    }

    store.closeStore();
    const reopened = await store.getStore();
    if (reopened.projects[0].name !== "smoke-updated") {
      throw new Error("重开数据库后数据不一致");
    }
    console.log({
      projects: reopened.projects.length,
      model: store.readStoredSettings().llm.model,
      database: join(dir, "app.db"),
      status: "ok",
    });
  } finally {
    store.closeStore();
    rmSync(dir, { recursive: true, force: true });
  }
}

void main();
