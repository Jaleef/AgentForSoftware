---
id: ADR-0007
title: 使用本地 SQLite 替代 JSON 文件
status: accepted
date: 2026-11-10
deciders:
  - architecture
  - tech-lead
related_code:
  - server/src/store.ts
  - server/src/storage
supersedes: ADR-0005
---

# ADR-0007：使用本地 SQLite 替代 JSON 文件

## 背景

原 `data/store.json` 是整文件 JSON，当前约 7 MB。每次写入都会重写整个文件，无法事务回滚，数据量增长后写放大明显，多实例和备份也受限。

## 决策

使用 Node 内置 `node:sqlite` 作为本地主存储：

- `data/app.db`；
- WAL 模式；
- 顶层实体表 + 每行完整 JSON payload；
- `mutateStore` 在事务中按实体 diff 写入；
- 旧 `store.json` / `settings.json` 自动迁移并备份。

不拆 requirements/designUnits/relations 关系表，保持 `StoreData` 和 API 不变。

## 备选方案

| 方案 | 优点 | 缺点 | 未选择原因 |
| --- | --- | --- | --- |
| 继续 JSON | 零依赖、可读 | 全量写、无事务、易损坏 | 已到瓶颈 |
| better-sqlite3 | 兼容 Node 20 | 原生依赖、Windows 构建 | 当前 Node 24 可用内置 |
| node:sqlite + 实体行 | 无依赖、事务、行级更新 | 嵌套数据仍以 JSON 存储 | 采用 |
| 完全范式化 SQLite | 查询能力强 | 迁移量大、风险高 | 非当前目标 |

## 后果

- 最低 Node 版本提升到 **24**；
- 写操作具备事务和行级更新；
- 数据文件从 `store.json` 变为 `app.db`；
- 迁移前 JSON 保留为 `*.migrated-*`；
- 当前仍只支持单进程写入，不支持多实例。

## 验证

- `pnpm store:smoke`；
- 用当前 `store.json` 副本迁移，核对 3 项目 / 6 文档 / 5 Campaign 等计数；
- `pnpm typecheck`、`pnpm build`、现有 smoke。

