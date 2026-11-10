---
id: DOC-API-001
title: REST API
status: approved
owner: backend
reviewers:
  - frontend
last_reviewed: 2026-11-08
related_code:
  - server/src/routes
  - server/src/index.ts
---
# REST API

## 1. 约定

- Base path：`/api`
- Content-Type：`application/json`，上传接口使用 `multipart/form-data`
- 错误响应：

```json
{ "error": "可读错误信息" }
```

- 列表接口默认返回摘要，详情接口返回完整结构；
- 后端对象字段以 `server/src/types.ts` 为准，本页只列主要路由和用途。

## 2. 健康检查

| 方法 | 路径            | 说明                                 |
| ---- | --------------- | ------------------------------------ |
| GET  | `/api/health` | 服务、版本、LLM 配置、环境、数据目录 |

## 3. 项目

| 方法   | 路径                                  | 说明               |
| ------ | ------------------------------------- | ------------------ |
| GET    | `/api/projects`                     | 项目列表           |
| POST   | `/api/projects`                     | 创建项目           |
| GET    | `/api/projects/:projectId`          | 项目详情与聚合统计 |
| GET    | `/api/projects/:projectId/overview` | 项目概览           |
| PATCH  | `/api/projects/:projectId`          | 更新项目           |
| DELETE | `/api/projects/:projectId`          | 级联删除项目       |

## 4. 文档

| 方法   | 路径                                                   | 说明                                                |
| ------ | ------------------------------------------------------ | --------------------------------------------------- |
| POST   | `/api/projects/:projectId/documents`                 | 上传 DOCX（`file`、`kind=srs\|sdd`、`useLlm`） |
| GET    | `/api/projects/:projectId/documents`                 | 文档摘要列表                                        |
| GET    | `/api/projects/:projectId/documents/:kind`           | 获取完整解析结果                                    |
| DELETE | `/api/projects/:projectId/documents/:docId`          | 删除文档                                            |
| POST   |  `/api/projects/:projectId/documents/:docId/reparse` | 重新拆分（只做规则解析，不自动 LLM）                                            |
| POST   | `/api/projects/:projectId/documents/:docId/enrich`   | LLM 整理                                            |

## 5. 需求单元

| 方法   | 路径                                            | 说明                           |
| ------ | ----------------------------------------------- | ------------------------------ |
| POST   | `/api/projects/:projectId/requirements`       | 手工新增，生成 `SRS-MAN-NNN` |
| DELETE | `/api/projects/:projectId/requirements/:code` | 删除并同步移除需求点           |
| PATCH  | `/api/projects/:projectId/requirements/:code` | 修改类型/审核备注/审核状态     |

新增请求示例：

```json
{
  "type": "接口需求",
  "title": "统一认证接口",
  "description": "系统应提供统一身份认证接口。",
  "detail": "认证失败返回 401。",
  "subsystem": "数字孪生平台",
  "obligations": "提供用户名口令认证\n提供令牌认证"
}
```

## 6. 设计单元

| 方法   | 路径                                            | 说明                           |
| ------ | ----------------------------------------------- | ------------------------------ |
| POST   | `/api/projects/:projectId/design-units`       | 手工新增，生成 `SDD-MAN-NNN` |
| DELETE | `/api/projects/:projectId/design-units/:code` | 删除并同步移除设计点           |
| PATCH  | `/api/projects/:projectId/design-units/:code` | 审核设计单元                   |

## 7. 代码快照

| 方法   | 路径                                                          | 说明                                     |
| ------ | ------------------------------------------------------------- | ---------------------------------------- |
| GET    | `/api/projects/:projectId/snapshots`                        | 快照列表                                 |
| POST   | `/api/projects/:projectId/snapshots`                        | 登记代码目录（`rootPath`、`commit`） |
| GET    | `/api/projects/:projectId/snapshots/:snapshotId/file?path=` | 读取文件符号                             |
| DELETE | `/api/projects/:projectId/snapshots/:snapshotId`            | 删除快照                                 |

## 8. 评价任务

| 方法   | 路径                                                                     | 说明                                             |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------ |
| POST   | `/api/projects/:projectId/campaigns`                                   | 创建任务（`levels`、`subsystems`、`name`） |
| GET    | `/api/projects/:projectId/campaigns`                                   | 任务列表（不含关系）                             |
| GET    | `/api/projects/:projectId/campaigns/:campaignId`                       | 任务详情；含 `agentRuns`；`?statusOnly=1` 只返回最近 5 条 |
| POST   | `/api/projects/:projectId/campaigns/:campaignId/cancel`                | 取消运行中任务                                   |
| DELETE | `/api/projects/:projectId/campaigns/:campaignId`                       | 删除任务                                         |
| PATCH  | `/api/projects/:projectId/campaigns/:campaignId/relations/:relationId` | 确认/驳回/重置关系                               |

## 9. 报告导出

| 方法 | 路径                                                                  | 说明     |
| ---- | --------------------------------------------------------------------- | -------- |
| GET  | `/api/projects/:projectId/campaigns/:campaignId/export?format=md`   | Markdown |
| GET  | `/api/projects/:projectId/campaigns/:campaignId/export?format=csv`  | CSV      |
| GET  | `/api/projects/:projectId/campaigns/:campaignId/export?format=json` | JSON     |

## 10. 设置

| 方法 | 路径                   | 说明                               |
| ---- | ---------------------- | ---------------------------------- |
| GET  | `/api/settings`      | 读取脱敏配置与来源                 |
| PUT  | `/api/settings`      | 保存配置；开发 `.env` 接管时 409 |
| POST | `/api/settings/test` | 连接测试；返回 `source`、脱敏 `apiKeyHint`；`.env` 变更未重启时返回 400 |

## 11. 状态码约定

| 状态码 | 含义                                            |
| ------ | ----------------------------------------------- |
| 200    | 成功                                            |
| 201    | 创建成功                                        |
| 400    | 参数/请求体错误                                 |
| 404    | 项目、文档、单元、任务不存在                    |
| 409    | 资源冲突（任务运行中、`.env` 接管、删除受限） |
| 500    | 未处理异常                                      |

## 12. 相关文档

- [数据流](数据流.md)
- [配置与运行](配置与运行.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
