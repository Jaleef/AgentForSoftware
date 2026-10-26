import cors from "cors";
import express from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, isLlmConfigured, readSettings } from "./store.js";
import { projectsRouter } from "./routes/projects.js";
import { documentsRouter } from "./routes/documents.js";
import { snapshotsRouter } from "./routes/snapshots.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { settingsRouter } from "./routes/settings.js";
import { recoverInterruptedCampaigns } from "./evaluation/runner.js";
import { recoverInterruptedDocuments } from "./services/documents.js";
import { getEnvConfigInfo } from "./config/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const webDist = resolve(packageRoot, "..", "web", "dist");

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  const settings = readSettings().llm;
  const env = getEnvConfigInfo();
  res.json({
    ok: true,
    service: "consistency-eval",
    version: "1.0.0",
    time: new Date().toISOString(),
    llmConfigured: isLlmConfigured(),
    llmMock: settings.mock,
    environment: env.environment,
    configSource: env.configSource,
    dataDir,
  });
});

// 将不同的路由统一挂载到 /api 前缀下面
app.use("/api", projectsRouter);
app.use("/api", documentsRouter);
app.use("/api", snapshotsRouter);
app.use("/api", campaignsRouter);
app.use("/api", settingsRouter);

// 以 /api 开头的请求，如果没有匹配到任何路由，则返回 404
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "接口不存在" });
});

if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(resolve(webDist, "index.html"));
  });
}

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({
        error: err.code === "LIMIT_FILE_SIZE" ? "文件超过 80MB 限制" : `上传失败：${err.message}`,
      });
      return;
    }
    console.error("[server]", err);
    res.status(500).json({ error: (err as Error)?.message ?? "服务器内部错误" });
  },
);

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

recoverInterruptedCampaigns();
recoverInterruptedDocuments();

app.listen(port, host, () => {
  console.log(`[consistency-eval] http://${host}:${port}  data=${dataDir}`);
  if (!existsSync(webDist)) {
    console.log("[consistency-eval] web/dist 尚未构建；开发模式请同时运行 pnpm dev:web（Vite: http://127.0.0.1:5173）");
  }
});
