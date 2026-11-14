---
id: DOC-API-001
title: REST API
status: approved
owner: backend
reviewers:
  - frontend
last_reviewed: 2026-11-13
related_code:
  - server/src/routes
  - web/src/api.ts
  - server/src/types.ts
---
# REST API

前后端接口契约。后端实现以 `server/src/routes` 为准，前端调用以 `web/src/api.ts` 为准。

## 1. 通用约定

- Base path：`/api`
- 前端通过同源相对路径 `/api` 请求；开发模式由 Vite 代理到后端。
- 请求/响应：`application/json`
- 上传接口：`multipart/form-data`
- 当前没有登录、Token 或租户头。
- ID 由后端生成，格式：

```text
prj_xxx   项目
doc_xxx   文档
snp_xxx   代码快照
cmp_xxx   评价任务
rel_xxx   关系
```

- 时间字段为 ISO 8601 字符串。
- 成功响应使用具名对象，例如 `{ project }`、`{ documents }`，不使用裸数组。
- 错误响应统一为：

```json
{ "error": "可读错误信息" }
```

- 异步任务通过轮询 `GET /api/projects/:projectId/campaigns/:campaignId?statusOnly=1` 获取进度。

---

## 2. 核心对象摘要

完整字段见 `server/src/types.ts` 和 `web/src/types.ts`。

### ProjectSummary

```ts
{
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  requirementDoc?: {
    id; originalName; status; uploadedAt; total; version; pageCount;
  };
  designDoc?: {
    id; originalName; status; uploadedAt; total; version; pageCount;
  };
  snapshot?: { id; rootPath; commit; createdAt; files; symbols };
  campaignCount: number;
  latestCampaign?: {
    id; name; status; score?; createdAt;
  };
  requirementStats: { total; byType: Record<string, number>; bySubsystem: Record<string, number> };
  designStats: { total; byType: Record<string, number>; bySubsystem: Record<string, number> };
}
```

### DocumentSummary

```ts
{
  id; projectId; kind: "srs" | "sdd";
  originalName; version; size; sha256;
  uploadedAt; updatedAt;
  status: "parsed" | "parsing" | "enriching" | "failed";
  useLlm; error?;
  pageCount;
  stats;
  warnings: string[];
  requirementCount;
  requirementPointCount;
  designCount;
  designPointCount;
}
```

### StoredDocument

`GET /documents/:kind` 返回完整文档对象，除摘要字段外还包含：

```text
requirements / requirementPoints / subsystemTaxonomy
designUnits / designPoints / designSubsystemTaxonomy
outline
agentRuns
```

### Campaign

```ts
{
  id; projectId; name;
  levels: Array<"requirement_design" | "design_code">;
  subsystems: string[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: { done; total; message };
  provider; model;
  method: "llm" | "heuristic";
  profile?: "economy" | "balanced" | "quality";
  usage?: { promptTokens; completionTokens; llmCalls };
  relations: Relation[];
  summary?: CampaignSummary;
  warnings?: string[];
  agentRuns?: AgentRun[];
  error?;
  createdAt; startedAt?; finishedAt?;
}
```

### CampaignSummary

```ts
{
  score: number;
  requirementCoverage: number;
  designCoverage: number;
  designCovered: number;
  designTotal: number;
  counts: {
    total; satisfied; partial; missing; mismatch; divergent;
  };
  gate: "pass" | "warn" | "fail";
  bySubsystem: ScoreBucket[];
  byType: ScoreBucket[];
  byLevel: Record<string, { total; score }>;
  findings: { p0; p1; p2 };
}
```

### Relation

```ts
{
  id; level: "requirement_design" | "design_code";
  sourceCode; sourceName; sourceType; sourceSubsystem;
  targetCodes: string[]; targetNames: string[];
  status: "satisfied" | "partial" | "missing" | "mismatch" | "divergent" | "unknown";
  confidence: number;
  severity: "p0" | "p1" | "p2";
  rationale; evidence;
  gaps: string[];
  suggestions;
  method: "llm" | "heuristic";
  reviewStatus: "pending" | "accepted" | "rejected";
  reviewNote;
  coverageRatio?;
  obligations?: RelationObligation[];
  targetCoverages?: TargetCoverage[];
}
```

### AgentRun

```ts
{
  id; agent; version; stage;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt; finishedAt?;
  model?; inputHash?; outputSummary?;
  warnings: string[];
  metrics?: { llmCalls; durationMs };
  error?;
}
```

### SnapshotMeta

```ts
{
  id; projectId;
  rootPath; commit; createdAt;
  status: "ready" | "parsing" | "failed";
  error?;
  stats: { files; lines; symbols; routes; models; byLanguage; skipped };
  warnings: string[];
  tree?: CodeTree;
}
```

---

## 3. 健康检查

### GET `/api/health`

响应：

```json
{
  "ok": true,
  "service": "consistency-eval",
  "version": "1.0.0",
  "time": "2026-11-13T08:00:00.000Z",
  "llmConfigured": true,
  "llmMock": false,
  "environment": "development",
  "configSource": "env",
  "dataDir": "C:\\Users\\jeffp\\codes\\AgentForSoftware\\data"
}
```

---

## 4. 项目

### GET `/api/projects`

响应：

```json
{ "projects": [ProjectSummary] }
```

### POST `/api/projects`

请求：

```json
{ "name": "DT 数字孪生", "description": "需求/设计评审" }
```

响应 `201`：

```json
{ "project": Project }
```

错误：

- `400`：名称为空或超过 80 字符。

### GET `/api/projects/:projectId`

响应：

```json
{ "project": ProjectSummary }
```

### DELETE `/api/projects/:projectId`

级联删除文档、快照、评价任务和上传文件。

响应：

```json
{ "ok": true }
```

---

## 5. 文档

### POST `/api/projects/:projectId/documents`

`multipart/form-data`：

| 字段       | 类型   | 必填 | 说明                                |
| ---------- | ------ | ---- | ----------------------------------- |
| `file`   | File   | 是   | `.docx`                           |
| `kind`   | string | 是   | `srs` 或 `sdd`                  |
| `useLlm` | string | 否   | `"true"` / `"false"`，默认 true |

响应 `201`：

```json
{ "document": DocumentSummary }
```

行为：

- 同项目同类型新文档会替换旧文档；
- `useLlm=true` 且配置了可用 LLM 时，后台启动整理；
- 文档状态会经历 `parsed → enriching → parsed`。

错误：

- `400`：非 DOCX、缺少文件、kind 非法、解析失败；
- `404`：项目不存在。

### GET `/api/projects/:projectId/documents`

响应：

```json
{ "documents": [DocumentSummary] }
```

### GET `/api/projects/:projectId/documents/:kind`

`kind` 只能是 `srs` / `sdd`。返回最新一份完整文档：

```json
{ "document": StoredDocument }
```

### DELETE `/api/projects/:projectId/documents/:docId`

响应：

```json
{ "ok": true }
```

### POST `/api/projects/:projectId/documents/:docId/reparse`

只做规则重新拆分，**不自动调用 LLM**。

响应：

```json
{ "document": DocumentSummary }
```

### POST `/api/projects/:projectId/documents/:docId/enrich`

启动后台 LLM 整理。

响应：

```json
{ "ok": true, "status": "enriching" }
```

错误：

- `400`：未配置可用 LLM；
- `404`：文档不存在。

整理期间前端轮询文档列表/详情，直到 `status` 从 `enriching` 回到 `parsed`。

---

## 6. 需求单元

### POST `/api/projects/:projectId/requirements`

手工新增需求，生成 `SRS-MAN-NNN`。

请求：

```json
{
  "type": "接口需求",
  "title": "统一认证接口",
  "description": "系统应提供统一身份认证接口。",
  "detail": "认证失败返回 401。",
  "subsystem": "数字孪生平台",
  "testSpec": "认证成功/失败用例",
  "obligations": "提供用户名口令认证\n提供令牌认证",
  "sourceId": "REQ-001",
  "reviewNote": "人工补充"
}
```

响应 `201`：

```json
{ "unit": RequirementUnit }
```

错误：

- `400`：类型非法、字段校验失败；
- `404`：项目不存在。

### DELETE `/api/projects/:projectId/requirements/:code`

响应：

```json
{ "ok": true, "deleted": RequirementUnit }
```

错误：

- `404`：单元不存在；
- `409`：文档正在 LLM 整理，暂不允许删除。

### PATCH `/api/projects/:projectId/requirements/:code`

请求：

```json
{
  "type": "功能需求",
  "reviewStatus": "confirmed",
  "reviewNote": "类型已人工确认"
}
```

`reviewStatus` 只接受 `pending` 或 `confirmed`。

响应：

```json
{ "unit": RequirementUnit, "stats": DocumentStats, "type": "功能需求" }
```

---

## 7. 设计单元

### POST `/api/projects/:projectId/design-units`

请求：

```json
{
  "type": "模块",
  "name": "模型管理模块",
  "description": "管理数字孪生模型。",
  "detail": "支持新增、修改、删除模型。",
  "subsystem": "数字孪生平台",
  "interfaceText": "ModelService",
  "input": "模型元数据",
  "output": "模型列表",
  "obligations": "支持模型新增\n支持模型删除",
  "sourceId": "SDD-001",
  "reviewNote": "人工补充"
}
```

响应 `201`：

```json
{ "unit": DesignUnit }
```

### DELETE `/api/projects/:projectId/design-units/:code`

响应：

```json
{ "ok": true, "deleted": DesignUnit }
```

### PATCH `/api/projects/:projectId/design-units/:code`

请求：

```json
{ "reviewStatus": "confirmed", "reviewNote": "设计已确认" }
```

响应：

```json
{ "unit": DesignUnit }
```

---

## 8. 代码快照

### POST `/api/projects/:projectId/snapshots`

请求：

```json
{ "rootPath": "C:\\code\\demo-app", "commit": "abc123" }
```

响应 `201`：

```json
{ "snapshot": { ...SnapshotMeta, "tree": CodeTree } }
```

错误：

- `400`：目录不存在/不可读；
- `404`：项目不存在。

每个项目只保留最近 3 个快照。

### GET `/api/projects/:projectId/snapshots`

响应：

```json
{ "snapshots": [SnapshotMeta] }
```

### GET `/api/projects/:projectId/snapshots/latest`

响应：

```json
{ "snapshot": { ...SnapshotMeta, "tree": CodeTree } }
```

### GET `/api/projects/:projectId/snapshots/:snapshotId/file?path=...`

响应：

```json
{ "file": CodeFile }
```

### DELETE `/api/projects/:projectId/snapshots/:snapshotId`

响应：

```json
{ "ok": true }
```

---

## 9. 评价任务

### POST `/api/projects/:projectId/campaigns`

请求：

```json
{
  "name": "V2.7.3 设计评审",
  "levels": ["requirement_design"],
  "subsystems": ["数字孪生平台"],
  "profile": "economy"
}
```

字段：

| 字段           | 必填 | 说明                                                        |
| -------------- | ---- | ----------------------------------------------------------- |
| `name`       | 否   | 默认自动生成                                                |
| `levels`     | 否   | 为空时自动选择可用层级                                      |
| `subsystems` | 否   | 空数组表示全部                                              |
| `profile`    | 否   | `economy` / `balanced` / `quality`，默认 `balanced` |

响应 `201`，任务已入队：

```json
{ "campaign": Campaign }
```

错误：

- `400`：文档/快照不满足所选层级；
- `404`：项目不存在；
- `409`：已有运行中任务。

### GET `/api/projects/:projectId/campaigns`

任务列表，`relations` 固定为空数组：

```json
{ "campaigns": [Campaign] }
```

### GET `/api/projects/:projectId/campaigns/:campaignId`

完整任务详情，包含 `relations`、`summary`、`agentRuns`、`profile`、`usage`。

### GET `/api/projects/:projectId/campaigns/:campaignId?statusOnly=1`

轮询专用：

```text
relations = []
agentRuns = 最近 5 条
```

其余进度字段正常返回。

### POST `/api/projects/:projectId/campaigns/:campaignId/cancel`

响应：

```json
{ "ok": true }
```

### PATCH `/api/projects/:projectId/campaigns/:campaignId/relations/:relationId`

请求：

```json
{
  "reviewStatus": "accepted",
  "reviewNote": "证据已人工确认"
}
```

`reviewStatus`：`pending` / `accepted` / `rejected`。

响应：

```json
{ "relation": Relation, "summary": CampaignSummary }
```

---

## 10. 报告导出

### GET `/api/projects/:projectId/campaigns/:campaignId/export?format=md|csv|json`

- `md`：`text/markdown`
- `csv`：`text/csv`（带 BOM）
- `json`：`application/json`

响应为文件下载，前端使用 `exportReportUrl()` 直接打开。

---

## 11. 设置

### GET `/api/settings`

响应：

```json
{
  "settings": {
    "baseUrl": "...",
    "model": "...",
    "temperature": 0.1,
    "maxTokens": 4096,
    "concurrency": 6,
    "timeoutMs": 120000,
    "jsonMode": true,
    "mock": false,
    "hasApiKey": true,
    "apiKeyHint": "sk-••••f487"
  },
  "configured": true,
  "meta": {
    "environment": "development",
    "configSource": "env",
    "envFile": "...",
    "envLoaded": true,
    "envActive": true,
    "envFileChanged": false,
    "shadowedKeys": [],
    "values": {
      "baseUrl": "...",
      "model": "...",
      "hasApiKey": true,
      "apiKeyHint": "sk-••••f487",
      "mock": false
    }
  }
}
```

### PUT `/api/settings`

请求：

```json
{
  "llm": {
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-flash",
    "apiKey": "sk-...",
    "temperature": 0.1,
    "maxTokens": 4096,
    "concurrency": 6,
    "timeoutMs": 120000,
    "jsonMode": true,
    "mock": false
  },
  "clearApiKey": false
}
```

- `apiKey` 为空或省略：保留已保存的 Key；
- `clearApiKey=true`：清除 Key；
- 开发环境 `.env` 接管时返回 `409`。

### POST `/api/settings/test`

请求可为空，或带页面表单：

```json
{ "llm": { "baseUrl": "...", "model": "...", "apiKey": "..." } }
```

成功：

```json
{
  "ok": true,
  "latencyMs": 1200,
  "message": "正常",
  "source": "env",
  "apiKeyHint": "sk-••••f487"
}
```

失败：

```json
{
  "error": "连接失败...（本次测试使用.env配置，Key：sk-••••f487）",
  "source": "env",
  "apiKeyHint": "sk-••••f487"
}
```

`.env` 在启动后被修改时，返回 `400`，提示重启开发服务。

---

## 12. 前端 API 方法映射

| 前端方法                            | 请求                                            |
| ----------------------------------- | ----------------------------------------------- |
| `api.listProjects()`              | `GET /projects`                               |
| `api.getProject(id)`              | `GET /projects/:id`                           |
| `api.createProject(name, desc)`   | `POST /projects`                              |
| `api.deleteProject(id)`           | `DELETE /projects/:id`                        |
| `api.listDocuments(id)`           | `GET /projects/:id/documents`                 |
| `api.getDocument(id, kind)`       | `GET /projects/:id/documents/:kind`           |
| `api.uploadDocument(...)`         | `POST /projects/:id/documents`                |
| `api.deleteDocument(...)`         | `DELETE /projects/:id/documents/:docId`       |
| `api.reparseDocument(...)`        | `POST /projects/:id/documents/:docId/reparse` |
| `api.enrichDocument(...)`         | `POST /projects/:id/documents/:docId/enrich`  |
| `api.createRequirement(...)`      | `POST /projects/:id/requirements`             |
| `api.deleteRequirement(...)`      | `DELETE /projects/:id/requirements/:code`     |
| `api.patchRequirement(...)`       | `PATCH /projects/:id/requirements/:code`      |
| `api.createDesignUnit(...)`       | `POST /projects/:id/design-units`             |
| `api.deleteDesignUnit(...)`       | `DELETE /projects/:id/design-units/:code`     |
| `api.patchDesignUnit(...)`        | `PATCH /projects/:id/design-units/:code`      |
| `api.listSnapshots(id)`           | `GET /projects/:id/snapshots`                 |
| `api.latestSnapshot(id)`          | `GET /projects/:id/snapshots/latest`          |
| `api.registerSnapshot(...)`       | `POST /projects/:id/snapshots`                |
| `api.getSnapshotFile(...)`        | `GET /projects/:id/snapshots/:sid/file?path=` |
| `api.deleteSnapshot(...)`         | `DELETE /projects/:id/snapshots/:sid`         |
| `api.listCampaigns(id)`           | `GET /projects/:id/campaigns`                 |
| `api.getCampaign(id, cid)`        | `GET /projects/:id/campaigns/:cid`            |
| `api.getCampaignStatus(...)`      | `GET ...?statusOnly=1`                        |
| `api.createCampaign(id, payload)` | `POST /projects/:id/campaigns`                |
| `api.cancelCampaign(...)`         | `POST .../cancel`                             |
| `api.reviewRelation(...)`         | `PATCH .../relations/:rid`                    |
| `api.exportReportUrl(...)`        | `GET .../export?format=`                      |
| `api.getSettings()`               | `GET /settings`                               |
| `api.saveSettings(...)`           | `PUT /settings`                               |
| `api.testSettings(...)`           | `POST /settings/test`                         |

---

## 13. 状态码

| 状态码 | 含义                                        |
| ------ | ------------------------------------------- |
| 200    | 成功                                        |
| 201    | 创建成功                                    |
| 400    | 参数/请求体/解析/连接测试失败               |
| 404    | 项目、文档、单元、快照、任务不存在          |
| 409    | 已有任务运行、文档整理中删除、`.env` 接管 |
| 500    | 未处理异常                                  |

---

## 14. 兼容性说明

- 评价任务不传 `profile` 时默认 `balanced`；
- 旧 Campaign 没有 `profile`/`usage` 时不报错；
- `statusOnly=1` 是轻量轮询接口，不要用它读取完整关系；
- `targetCoverages` / `obligations` 是需求→设计的义务覆盖矩阵字段；
- 设计→代码关系没有义务矩阵，使用 `targetCodes` / `targetNames`。

## 15. 相关文档

- [数据流](数据流.md)
- [配置与运行](配置与运行.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [评价口径](EVALUATION.md)
